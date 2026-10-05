import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';

import { CONSTANTS } from '../../../common/configuration/constants';
import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';

export interface RangoSolicitado {
  inicio: number;
  fin: number;
}

export interface ArchivoAbierto {
  flujo: Readable;
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

/** Neon Object Storage es S3-compatible; el bucket permanece privado. */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly cliente: S3Client | null = this.crearCliente();

  async prepararCarpetas(): Promise<void> {
    // Se conserva el hook para no bloquear el arranque de documentos pendientes.
  }

  async guardarDefinitivo(
    origen: string | Buffer,
    userId: string,
    documentId: string,
    tipo: TipoDocumento,
  ): Promise<string> {
    const clave = `${userId}/${documentId}.${EXTENSION[tipo]}`;
    const cuerpo = Buffer.isBuffer(origen) ? origen : createReadStream(origen);

    try {
      await this.clienteRequerido().send(
        new PutObjectCommand({
          Bucket: CONSTANTS.S3_BUCKET,
          Key: clave,
          Body: cuerpo,
          ContentType: MIME_POR_TIPO[tipo],
        }),
      );
    } finally {
      if (typeof origen === 'string') {
        await rm(origen, { force: true });
      }
    }

    return clave;
  }

  async tamano(clave: string): Promise<number> {
    try {
      const respuesta = await this.clienteRequerido().send(
        new HeadObjectCommand({ Bucket: CONSTANTS.S3_BUCKET, Key: clave }),
      );
      return Number(respuesta.ContentLength ?? 0);
    } catch {
      throw new NotFoundException('Error al obtener el libro, intenta subirlo');
    }
  }

  async abrir(clave: string, rango?: RangoSolicitado): Promise<ArchivoAbierto> {
    const tamano = await this.tamano(clave);
    const inicio = rango ? Math.min(rango.inicio, tamano - 1) : 0;
    const fin = rango ? Math.min(rango.fin, tamano - 1) : tamano - 1;

    try {
      const respuesta = await this.clienteRequerido().send(
        new GetObjectCommand({
          Bucket: CONSTANTS.S3_BUCKET,
          Key: clave,
          ...(rango ? { Range: `bytes=${inicio}-${fin}` } : {}),
        }),
      );

      if (!respuesta.Body) throw new Error('Object Storage devolvió una respuesta vacía.');
      return {
        flujo: respuesta.Body as Readable,
        tamano,
        inicio,
        fin,
        esParcial: rango !== undefined,
      };
    } catch {
      throw new NotFoundException('Error al obtener el libro, intenta subirlo');
    }
  }

  async eliminar(clave: string | null): Promise<void> {
    if (!clave) return;

    // Durante la validación de extensión todavía puede llegar la ruta temporal de Multer.
    if (isAbsolute(clave)) {
      await rm(clave, { force: true });
      return;
    }

    await this.clienteRequerido().send(
      new DeleteObjectCommand({ Bucket: CONSTANTS.S3_BUCKET, Key: clave }),
    );
  }

  async leer(clave: string): Promise<Buffer> {
    try {
      const respuesta = await this.clienteRequerido().send(
        new GetObjectCommand({ Bucket: CONSTANTS.S3_BUCKET, Key: clave }),
      );
      if (!respuesta.Body) throw new Error('Object Storage devolvió una respuesta vacía.');

      const partes: Buffer[] = [];
      for await (const parte of respuesta.Body as AsyncIterable<Buffer | Uint8Array | string>) {
        partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte));
      }
      return Buffer.concat(partes);
    } catch (error) {
      this.logger.warn(`No se pudo leer el objeto ${clave}: ${String(error)}`);
      throw new NotFoundException('Error al obtener el libro, intenta subirlo');
    }
  }

  interpretarRango(cabecera: string | undefined, tamanoConocido: number): RangoSolicitado | undefined {
    if (!cabecera) return undefined;
    const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
    if (!coincidencia) return undefined;
    const [, desde, hasta] = coincidencia;
    if (desde === '') {
      const longitud = Number(hasta);
      if (!longitud) return undefined;
      return { inicio: Math.max(tamanoConocido - longitud, 0), fin: tamanoConocido - 1 };
    }
    return { inicio: Number(desde), fin: hasta === '' ? tamanoConocido - 1 : Number(hasta) };
  }

  private crearCliente(): S3Client | null {
    if (
      !CONSTANTS.AWS_ENDPOINT_URL_S3 ||
      !CONSTANTS.AWS_REGION ||
      !CONSTANTS.AWS_ACCESS_KEY_ID ||
      !CONSTANTS.AWS_SECRET_ACCESS_KEY ||
      !CONSTANTS.S3_BUCKET
    ) {
      return null;
    }

    return new S3Client({
      region: CONSTANTS.AWS_REGION,
      endpoint: CONSTANTS.AWS_ENDPOINT_URL_S3,
      credentials: {
        accessKeyId: CONSTANTS.AWS_ACCESS_KEY_ID,
        secretAccessKey: CONSTANTS.AWS_SECRET_ACCESS_KEY,
      },
      forcePathStyle: CONSTANTS.S3_FORCE_PATH_STYLE,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private clienteRequerido(): S3Client {
    if (!this.cliente) {
      throw new Error(
        'Neon Object Storage no está configurado. Define AWS_ENDPOINT_URL_S3, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION y S3_FORCE_PATH_STYLE.',
      );
    }
    return this.cliente;
  }
}
