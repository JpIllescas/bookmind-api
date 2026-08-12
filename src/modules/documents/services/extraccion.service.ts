import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import StreamZip from 'node-stream-zip';

import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';

/** Una página (PDF) o una sección del spine (EPUB). */
export interface PaginaExtraida {
  pagina: number;
  texto: string;
}

export interface ResultadoExtraccion {
  paginas: PaginaExtraida[];
  textoCompleto: string;
  totalPaginas: number;
}

/** Debajo de esto casi seguro es un escaneo, no un libro con texto. */
const MINIMO_PALABRAS_TOTALES = 120;

/** Proporción de páginas casi vacías que delata un PDF escaneado. */
const UMBRAL_PAGINAS_VACIAS = 0.7;
const MINIMO_PALABRAS_POR_PAGINA = 10;

@Injectable()
export class ExtraccionService {
  private readonly logger = new Logger(ExtraccionService.name);

  async extraer(
    buffer: Buffer,
    tipo: TipoDocumento,
  ): Promise<ResultadoExtraccion> {
    const paginas =
      tipo === TipoDocumento.PDF
        ? await this.extraerDePdf(buffer)
        : await this.extraerDeEpub(buffer);

    const conTexto = paginas.filter((p) => p.texto.trim().length > 0);
    const textoCompleto = this.normalizar(
      conTexto.map((p) => p.texto).join('\n\n'),
    );

    this.verificarCalidad(paginas, textoCompleto);

    return {
      paginas,
      textoCompleto,
      totalPaginas: paginas.length,
    };
  }

  /** Página por página, que es lo que permite citar dónde estaba cada cosa. */
  private async extraerDePdf(buffer: Buffer): Promise<PaginaExtraida[]> {
    // Import dinámico: pdfjs-dist es ESM y esto compila a CommonJS.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    const tarea = pdfjs.getDocument({
      // Copia: pdf.js se queda con el buffer y reutilizarlo lo corrompe.
      data: new Uint8Array(buffer),
      // Sin esto, pdf.js intenta descargar mapas de caracteres por HTTP.
      useSystemFonts: true,
    });

    const documento = await tarea.promise;

    try {
      const paginas: PaginaExtraida[] = [];

      for (let numero = 1; numero <= documento.numPages; numero += 1) {
        const pagina = await documento.getPage(numero);
        const contenido = await pagina.getTextContent();

        const texto = contenido.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');

        paginas.push({ pagina: numero, texto: this.normalizar(texto) });
        // Sin esto un libro de 300 páginas queda entero en memoria.
        pagina.cleanup();
      }

      return paginas;
    } finally {
      // En pdf.js v6 `destroy()` está en la tarea: si no, el worker queda vivo.
      await tarea.destroy();
    }
  }

  /** Recorre el spine del EPUB: su orden hace de número de página. */
  private async extraerDeEpub(buffer: Buffer): Promise<PaginaExtraida[]> {
    // node-stream-zip lee de archivo, no de buffer: no descomprime en memoria.
    const { file, limpiar } = await this.escribirTemporal(buffer);
    const zip = new StreamZip.async({ file, storeEntries: true });

    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });

      // 1. META-INF/container.xml apunta al archivo OPF (el índice del libro).
      const container = parser.parse(
        (await zip.entryData('META-INF/container.xml')).toString('utf-8'),
      ) as any;

      const rutaOpf: string | undefined =
        container?.container?.rootfiles?.rootfile?.['@_full-path'];

      if (!rutaOpf) {
        throw new BadRequestException(
          'El EPUB no declara un archivo OPF válido en META-INF/container.xml.',
        );
      }

      // 2. El OPF trae el manifest (id -> archivo) y el spine (orden de lectura).
      const opf = parser.parse(
        (await zip.entryData(rutaOpf)).toString('utf-8'),
      ) as any;

      const paquete = opf?.package ?? {};
      const manifest = this.comoArreglo(paquete?.manifest?.item);
      const spine = this.comoArreglo(paquete?.spine?.itemref);

      const porId = new Map<string, string>();
      for (const item of manifest) {
        if (item?.['@_id'] && item?.['@_href']) {
          porId.set(String(item['@_id']), String(item['@_href']));
        }
      }

      // Las rutas del manifest son relativas a la carpeta del OPF.
      const baseOpf = rutaOpf.includes('/')
        ? rutaOpf.slice(0, rutaOpf.lastIndexOf('/') + 1)
        : '';

      const paginas: PaginaExtraida[] = [];

      for (const [indice, itemref] of spine.entries()) {
        const idref = itemref?.['@_idref'];
        const href = idref ? porId.get(String(idref)) : undefined;
        if (!href) continue;

        try {
          const contenido = await zip.entryData(baseOpf + href);
          paginas.push({
            pagina: indice + 1,
            texto: this.quitarEtiquetas(contenido.toString('utf-8')),
          });
        } catch {
          // Una sección ilegible no debe tumbar el libro entero.
          this.logger.warn(`No se pudo leer la sección ${href} del EPUB.`);
        }
      }

      return paginas;
    } finally {
      await zip.close().catch(() => undefined);
      await limpiar();
    }
  }

  private async escribirTemporal(buffer: Buffer) {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const carpeta = await mkdtemp(join(tmpdir(), 'bookmind-epub-'));
    const file = join(carpeta, 'libro.epub');
    await writeFile(file, buffer);

    return {
      file,
      limpiar: () => rm(carpeta, { recursive: true, force: true }),
    };
  }

  /** fast-xml-parser colapsa las listas de un solo elemento. */
  private comoArreglo(valor: unknown): any[] {
    if (valor === undefined || valor === null) return [];
    return Array.isArray(valor) ? valor : [valor];
  }

  private quitarEtiquetas(html: string): string {
    const sinBloquesInvisibles = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ');

    const texto = sinBloquesInvisibles
      // Sin esto el final de un párrafo se pega con el inicio del siguiente.
      .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    return this.normalizar(this.decodificarEntidades(texto));
  }

  private decodificarEntidades(texto: string): string {
    const entidades: Record<string, string> = {
      '&nbsp;': ' ',
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&apos;': "'",
      '&#39;': "'",
    };

    return texto
      .replace(/&[a-z]+;|&#39;/gi, (e) => entidades[e.toLowerCase()] ?? e)
      .replace(/&#(\d+);/g, (_, codigo: string) =>
        String.fromCharCode(Number.parseInt(codigo, 10)),
      );
  }

  /** Limpia los artefactos típicos de la extracción. */
  private normalizar(texto: string): string {
    return texto
      // Une palabras cortadas por guion: "matemá-\nticas".
      .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Falla al subir, no después: un escaneo produce un documento vacío. */
  private verificarCalidad(
    paginas: PaginaExtraida[],
    textoCompleto: string,
  ): void {
    const totalPalabras = textoCompleto.split(/\s+/).filter(Boolean).length;

    if (paginas.length === 0) {
      throw new BadRequestException(
        'No se pudo leer ninguna página del archivo.',
      );
    }

    const casiVacias = paginas.filter(
      (p) => p.texto.split(/\s+/).filter(Boolean).length < MINIMO_PALABRAS_POR_PAGINA,
    ).length;

    if (casiVacias / paginas.length > UMBRAL_PAGINAS_VACIAS) {
      throw new BadRequestException(
        `${casiVacias} de ${paginas.length} páginas no contienen texto. ` +
          'El documento parece estar escaneado como imágenes. BookMind necesita ' +
          'un archivo con texto seleccionable; prueba con una versión digital ' +
          'del libro.',
      );
    }

    if (totalPalabras < MINIMO_PALABRAS_TOTALES) {
      throw new BadRequestException(
        `Solo se extrajeron ${totalPalabras} palabras del documento. ` +
          'Es demasiado poco para estudiar con él.',
      );
    }
  }
}
