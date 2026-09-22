import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import StreamZip from 'node-stream-zip';

import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';
import { CapituloDetectado, capitulosDesdeMarcas } from './deteccion-capitulos';

/** Una página (PDF) o una sección del spine (EPUB). */
export interface PaginaExtraida {
  pagina: number;
  texto: string;
}

/** `sin_texto` es un escaneo: se puede mostrar, pero no alimenta al chat ni al clasificador. */
export type CapaTexto = 'ok' | 'sin_texto';

export interface ResultadoExtraccion {
  paginas: PaginaExtraida[];
  textoCompleto: string;
  totalPaginas: number;
  capaTexto: CapaTexto;
  /** Del índice del archivo; vacío cuando el editor no lo incluyó. */
  capitulos: CapituloDetectado[];
}

interface Extraido {
  paginas: PaginaExtraida[];
  capitulos: CapituloDetectado[];
}

/** Título con página, tal como lo declara el índice del archivo. */
interface Marca {
  titulo: string;
  pagina: number;
}

/** Lo que se usa de pdf.js; el tipo real vive en un módulo ESM importado en caliente. */
interface DocumentoPdf {
  numPages: number;
  getOutline(): Promise<{ title: string; dest: unknown }[] | null>;
  getDestination(nombre: string): Promise<unknown[] | null>;
  getPageIndex(referencia: unknown): Promise<number>;
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
    const { paginas, capitulos } =
      tipo === TipoDocumento.PDF
        ? await this.extraerDePdf(buffer)
        : await this.extraerDeEpub(buffer);

    const conTexto = paginas.filter((p) => p.texto.trim().length > 0);
    const textoCompleto = this.normalizar(
      conTexto.map((p) => p.texto).join('\n\n'),
    );

    return {
      paginas,
      textoCompleto,
      totalPaginas: paginas.length,
      capaTexto: this.evaluarCapaTexto(paginas, textoCompleto),
      capitulos,
    };
  }

  /** Página por página, que es lo que permite citar dónde estaba cada cosa. */
  private async extraerDePdf(buffer: Buffer): Promise<Extraido> {
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

      return {
        paginas,
        capitulos: await this.capitulosDelOutline(documento as unknown as DocumentoPdf),
      };
    } finally {
      // En pdf.js v6 `destroy()` está en la tarea: si no, el worker queda vivo.
      await tarea.destroy();
    }
  }

  /** El índice del PDF, cuando el editor lo incluyó: títulos reales y páginas exactas. */
  private async capitulosDelOutline(documento: DocumentoPdf): Promise<CapituloDetectado[]> {
    const outline = await documento.getOutline().catch(() => null);
    if (!outline || outline.length === 0) return [];

    const marcas: Marca[] = [];

    // Solo el primer nivel: las subsecciones sobran para navegar.
    for (const entrada of outline) {
      try {
        const destino =
          typeof entrada.dest === 'string'
            ? await documento.getDestination(entrada.dest)
            : (entrada.dest as unknown[] | null);

        if (!destino?.[0]) continue;

        marcas.push({
          titulo: entrada.title.replace(/\s+/g, ' ').trim(),
          pagina: (await documento.getPageIndex(destino[0])) + 1,
        });
      } catch {
        // Una entrada rota del índice no invalida las demás.
      }
    }

    return capitulosDesdeMarcas(marcas, documento.numPages);
  }

  /** Recorre el spine del EPUB: su orden hace de número de página. */
  private async extraerDeEpub(buffer: Buffer): Promise<Extraido> {
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
      // Con qué "página" (posición en el spine) se corresponde cada archivo.
      const paginaPorHref = new Map<string, number>();

      for (const [indice, itemref] of spine.entries()) {
        const idref = itemref?.['@_idref'];
        const href = idref ? porId.get(String(idref)) : undefined;
        if (!href) continue;

        paginaPorHref.set(href, indice + 1);

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

      const capitulos = await this.capitulosDelEpub(
        zip,
        parser,
        baseOpf,
        manifest,
        paquete?.spine?.['@_toc'],
        paginaPorHref,
        paginas.length,
      );

      return { paginas, capitulos };
    } finally {
      await zip.close().catch(() => undefined);
      await limpiar();
    }
  }

  /** La tabla de contenido del EPUB: nav.xhtml (EPUB 3) o toc.ncx (EPUB 2). */
  private async capitulosDelEpub(
    zip: InstanceType<typeof StreamZip.async>,
    parser: XMLParser,
    baseOpf: string,
    manifest: any[],
    idNcx: unknown,
    paginaPorHref: Map<string, number>,
    ultimaPagina: number,
  ): Promise<CapituloDetectado[]> {
    const nav = manifest.find((item) =>
      String(item?.['@_properties'] ?? '').split(/\s+/).includes('nav'),
    );
    const ncx =
      manifest.find((item) => item?.['@_id'] === idNcx) ??
      manifest.find((item) => item?.['@_media-type'] === 'application/x-dtbncx+xml');

    const marcas: Marca[] = [];

    // El href de la tabla apunta al archivo (con o sin #ancla); la página es la del spine.
    const paginaDe = (href: unknown): number | undefined =>
      paginaPorHref.get(String(href ?? '').split('#')[0]);

    try {
      if (nav?.['@_href']) {
        const xhtml = parser.parse(
          (await zip.entryData(baseOpf + String(nav['@_href']))).toString('utf-8'),
        ) as any;
        const navs = this.comoArreglo(xhtml?.html?.body?.nav);
        const toc =
          navs.find((n) => String(n?.['@_epub:type'] ?? '') === 'toc') ?? navs[0];

        for (const li of this.comoArreglo(toc?.ol?.li)) {
          const enlace = this.comoArreglo(li?.a)[0];
          const pagina = paginaDe(enlace?.['@_href']);
          const titulo = this.textoDe(enlace);
          if (pagina && titulo) marcas.push({ titulo, pagina });
        }
      } else if (ncx?.['@_href']) {
        const doc = parser.parse(
          (await zip.entryData(baseOpf + String(ncx['@_href']))).toString('utf-8'),
        ) as any;

        for (const punto of this.comoArreglo(doc?.ncx?.navMap?.navPoint)) {
          const pagina = paginaDe(this.comoArreglo(punto?.content)[0]?.['@_src']);
          const titulo = this.textoDe(this.comoArreglo(punto?.navLabel)[0]?.text);
          if (pagina && titulo) marcas.push({ titulo, pagina });
        }
      }
    } catch {
      this.logger.warn('No se pudo leer la tabla de contenido del EPUB.');
    }

    return capitulosDesdeMarcas(marcas, ultimaPagina);
  }

  /** Texto de un nodo del parser, aunque venga envuelto en <span> u otras etiquetas. */
  private textoDe(nodo: unknown): string {
    if (nodo === null || nodo === undefined) return '';
    if (typeof nodo !== 'object') return String(nodo).replace(/\s+/g, ' ').trim();

    return Object.entries(nodo as Record<string, unknown>)
      .filter(([clave]) => !clave.startsWith('@_'))
      .map(([, valor]) => this.textoDe(valor))
      .filter(Boolean)
      .join(' ');
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
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Decide si el texto sirve para estudiar; un escaneo se marca, no se rechaza. */
  private evaluarCapaTexto(
    paginas: PaginaExtraida[],
    textoCompleto: string,
  ): CapaTexto {
    // Sin páginas no hay nada que mostrar: el archivo está corrupto o no es lo que dice.
    if (paginas.length === 0) {
      throw new BadRequestException(
        'No se pudo leer ninguna página del archivo.',
      );
    }

    const totalPalabras = textoCompleto.split(/\s+/).filter(Boolean).length;

    const casiVacias = paginas.filter(
      (p) => p.texto.split(/\s+/).filter(Boolean).length < MINIMO_PALABRAS_POR_PAGINA,
    ).length;

    const escaneado = casiVacias / paginas.length > UMBRAL_PAGINAS_VACIAS;

    if (escaneado || totalPalabras < MINIMO_PALABRAS_TOTALES) {
      this.logger.warn(
        `Documento sin capa de texto: ${casiVacias} de ${paginas.length} ` +
          `páginas vacías, ${totalPalabras} palabras en total.`,
      );

      return 'sin_texto';
    }

    return 'ok';
  }
}
