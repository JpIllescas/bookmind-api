import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import {
  AlmacenamientoNoDisponibleError,
  ArchivoNoEncontradoError,
  ProveedorAlmacenamiento,
} from './proveedor-almacenamiento';

export interface ConfigS3 {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

const VARIABLES_S3: Record<keyof Omit<ConfigS3, 'forcePathStyle'>, string> = {
  endpoint: 'AWS_ENDPOINT_URL_S3',
  region: 'AWS_REGION',
  accessKeyId: 'AWS_ACCESS_KEY_ID',
  secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
  bucket: 'S3_BUCKET',
};

/** Nombres de las variables de entorno que faltan para hablar con S3. */
export function variablesS3Faltantes(config: ConfigS3): string[] {
  return (Object.keys(VARIABLES_S3) as (keyof typeof VARIABLES_S3)[])
    .filter((campo) => !config[campo])
    .map((campo) => VARIABLES_S3[campo]);
}

/** Neon Object Storage es S3-compatible; el bucket permanece privado. */
export class AlmacenamientoS3 implements ProveedorAlmacenamiento {
  readonly nombre = 's3' as const;
  private readonly cliente: S3Client | null;
  private readonly faltantes: string[];

  constructor(
    private readonly config: ConfigS3,
    cliente?: S3Client,
  ) {
    this.faltantes = variablesS3Faltantes(config);
    this.cliente = cliente ?? (this.faltantes.length ? null : this.crearCliente());
  }

  async guardar(clave: string, origen: Buffer | string, mime: string): Promise<void> {
    await this.enviar(
      clave,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: clave,
        Body: Buffer.isBuffer(origen) ? origen : createReadStream(origen),
        ContentType: mime,
      }),
    );
  }

  async tamano(clave: string): Promise<number> {
    const respuesta = await this.enviar<HeadObjectCommandOutput>(
      clave,
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: clave }),
    );
    return Number(respuesta.ContentLength ?? 0);
  }

  async abrir(clave: string, rango?: { inicio: number; fin: number }): Promise<Readable> {
    const respuesta = await this.enviar<GetObjectCommandOutput>(
      clave,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: clave,
        ...(rango ? { Range: `bytes=${rango.inicio}-${rango.fin}` } : {}),
      }),
    );
    if (!respuesta.Body) {
      throw new AlmacenamientoNoDisponibleError(`S3 devolvió un cuerpo vacío para "${clave}".`);
    }
    return respuesta.Body as Readable;
  }

  async leer(clave: string): Promise<Buffer> {
    const flujo = await this.abrir(clave);
    const partes: Buffer[] = [];
    try {
      for await (const parte of flujo as AsyncIterable<Buffer | Uint8Array | string>) {
        partes.push(Buffer.isBuffer(parte) ? parte : Buffer.from(parte));
      }
    } catch (error) {
      throw this.traducir(error, clave);
    }
    return Buffer.concat(partes);
  }

  async eliminar(clave: string): Promise<void> {
    await this.enviar(clave, new DeleteObjectCommand({ Bucket: this.config.bucket, Key: clave }));
  }

  // Un solo punto de salida a S3 para que todos los errores se traduzcan igual.
  private async enviar<T>(clave: string, comando: Parameters<S3Client['send']>[0]): Promise<T> {
    if (!this.cliente) {
      throw new AlmacenamientoNoDisponibleError(
        `STORAGE_DRIVER=s3 pero faltan ${this.faltantes.join(', ')} en el .env del backend.`,
      );
    }
    try {
      return (await this.cliente.send(comando as never)) as T;
    } catch (error) {
      throw this.traducir(error, clave);
    }
  }

  private traducir(error: unknown, clave: string): Error {
    const { name, $metadata } = (error ?? {}) as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404) {
      return new ArchivoNoEncontradoError(clave);
    }
    return new AlmacenamientoNoDisponibleError(
      `S3 (${this.config.endpoint}, bucket ${this.config.bucket}) falló con "${clave}": ${String(error)}`,
      { cause: error },
    );
  }

  private crearCliente(): S3Client {
    return new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }
}
