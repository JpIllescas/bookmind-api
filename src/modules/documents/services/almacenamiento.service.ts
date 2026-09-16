import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { CONSTANTS } from '../../../common/configuration/constants';
import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';

/** Trozo de archivo pedido por el visor con una cabecera Range. */
export interface RangoSolicitado {
  inicio: number;
  fin: number;
}

export interface ArchivoAbierto {
  flujo: ReadStream;
  tamano: number;
  inicio: number;
  fin: number;
  esParcial: boolean;
}

const EXTENSION: Record<TipoDocumento, string> = {
  [TipoDocumento.PDF]: 'pdf',
  [TipoDocumento.EPUB]: 'epub',
};

export const MIME_POR_TIPO: Record<TipoDocumento, string> = {
  [TipoDocumento.PDF]: 'application/pdf',
  [TipoDocumento.EPUB]: 'application/epub+zip',
};

/** Guarda y sirve el archivo original del libro desde UPLOAD_PATH. */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly raiz = resolve(CONSTANTS.UPLOAD_PATH);

  /** Carpeta donde Multer deja el archivo antes de conocerse el id del documento. */
  get carpetaTemporal(): string {
    return join(this.raiz, 'tmp');
  }

  async prepararCarpetas(): Promise<void> {
    await mkdir(this.carpetaTemporal, { recursive: true });
  }

  /** Mueve el archivo recién subido a su ubicación definitiva. */
  async guardarDefinitivo(
    origen: string,
    userId: string,
    documentId: string,
    tipo: TipoDocumento,
  ): Promise<string> {
    const relativo = join(userId, `${documentId}.${EXTENSION[tipo]}`);
    const destino = join(this.raiz, relativo);

    await mkdir(dirname(destino), { recursive: true });

    try {
      await rename(origen, destino);
    } catch {
      // rename falla si tmp y la carpeta final están en discos distintos.
      await copyFile(origen, destino);
      await rm(origen, { force: true });
    }

    return relativo;
  }

  async tamano(rutaRelativa: string): Promise<number> {
    const { size } = await stat(this.rutaAbsoluta(rutaRelativa)).catch(() => {
      throw new NotFoundException('El archivo del documento ya no está disponible.');
    });

    return size;
  }

  /** Abre el archivo completo o el rango pedido, para responder 200 o 206. */
  async abrir(
    rutaRelativa: string,
    rango?: RangoSolicitado,
  ): Promise<ArchivoAbierto> {
    const ruta = this.rutaAbsoluta(rutaRelativa);
    const { size } = await stat(ruta).catch(() => {
      throw new NotFoundException('El archivo del documento ya no está disponible.');
    });

    const inicio = rango ? Math.min(rango.inicio, size - 1) : 0;
    const fin = rango ? Math.min(rango.fin, size - 1) : size - 1;

    return {
      flujo: createReadStream(ruta, { start: inicio, end: fin }),
      tamano: size,
      inicio,
      fin,
      esParcial: rango !== undefined,
    };
  }

  async eliminar(rutaRelativa: string | null): Promise<void> {
    if (!rutaRelativa) return;

    await rm(this.rutaAbsoluta(rutaRelativa), { force: true }).catch(
      (error: unknown) =>
        this.logger.warn(`No se pudo borrar ${rutaRelativa}: ${String(error)}`),
    );
  }

  async leer(rutaRelativa: string): Promise<Buffer> {
    return readFile(this.rutaAbsoluta(rutaRelativa));
  }

  /** Interpreta "bytes=0-1023"; devuelve undefined si la cabecera no es usable. */
  interpretarRango(
    cabecera: string | undefined,
    tamanoConocido: number,
  ): RangoSolicitado | undefined {
    if (!cabecera) return undefined;

    const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
    if (!coincidencia) return undefined;

    const [, desde, hasta] = coincidencia;

    // "bytes=-500" pide los últimos 500 bytes.
    if (desde === '') {
      const longitud = Number(hasta);
      if (!longitud) return undefined;
      return { inicio: Math.max(tamanoConocido - longitud, 0), fin: tamanoConocido - 1 };
    }

    return {
      inicio: Number(desde),
      fin: hasta === '' ? tamanoConocido - 1 : Number(hasta),
    };
  }

  /** Evita que una ruta manipulada salga de UPLOAD_PATH. */
  private rutaAbsoluta(rutaRelativa: string): string {
    const absoluta = isAbsolute(rutaRelativa)
      ? rutaRelativa
      : join(this.raiz, rutaRelativa);
    const normalizada = resolve(absoluta);

    if (!normalizada.startsWith(this.raiz)) {
      throw new NotFoundException('Ruta de archivo inválida.');
    }

    return normalizada;
  }
}
