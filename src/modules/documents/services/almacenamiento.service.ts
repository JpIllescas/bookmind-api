import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';

import { CONSTANTS } from '../../../common/configuration/constants';
import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';
import { AlmacenamientoLocal } from './almacenamiento/almacenamiento-local';
import { AlmacenamientoS3, ConfigS3, variablesS3Faltantes } from './almacenamiento/almacenamiento-s3';
import { CacheLibros } from './almacenamiento/cache-libros';
import {
  AlmacenamientoNoDisponibleError,
  ArchivoNoEncontradoError,
  DriverAlmacenamiento,
  ProveedorAlmacenamiento,
} from './almacenamiento/proveedor-almacenamiento';

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

/** `<usuario>/<id del documento>.<ext>`, la clave que arma guardarDefinitivo. */
const CLAVE_DE_LIBRO = /^[^/\\]+\/([0-9a-f-]{36})\.(pdf|epub)$/i;

const MENSAJE_NO_ENCONTRADO =
  'No encontramos el archivo de este libro. Bórralo de tu biblioteca y vuelve a subirlo.';
const MENSAJE_NO_DISPONIBLE =
  'El almacenamiento de libros no está disponible en este momento. ' +
  'Intenta de nuevo en unos minutos; si sigue pasando, avisa al administrador.';

/** Elige el driver (STORAGE_DRIVER) y convierte sus errores en respuestas para el estudiante. */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly local = new AlmacenamientoLocal(CONSTANTS.UPLOAD_PATH);
  private readonly activo: ProveedorAlmacenamiento;
  private readonly faltantesS3: string[];
  private readonly cache = new CacheLibros(CONSTANTS.CACHE_LIBROS_PATH, (Number(CONSTANTS.CACHE_LIBROS_MB) || 0) * 1024 * 1024);
  private readonly tamanos = new Map<string, number>();

  constructor() {
    const configS3 = this.configS3();
    const driver = this.elegirDriver(configS3);
    this.activo = driver === 's3' ? new AlmacenamientoS3(configS3) : this.local;

    this.faltantesS3 = driver === 's3' ? variablesS3Faltantes(configS3) : [];
    if (this.faltantesS3.length) {
      this.logger.error(
        `STORAGE_DRIVER=s3 pero faltan ${this.faltantesS3.join(', ')}: subir y abrir libros responderá 503.`,
      );
    } else {
      this.logger.log(`Almacenamiento de libros: ${driver}.`);
    }
  }

  get driver(): DriverAlmacenamiento {
    return this.activo.nombre;
  }

  /** Para /api/health: qué driver está activo y si tiene lo que necesita. */
  estado(): { driver: DriverAlmacenamiento; configurado: boolean; faltan: string[] } {
    return { driver: this.activo.nombre, configurado: this.faltantesS3.length === 0, faltan: this.faltantesS3 };
  }

  async prepararCarpetas(): Promise<void> {
    // Con s3 la carpeta solo sirve para los libros viejos; si no se puede crear, no se bloquea el arranque.
    await this.local.prepararRaiz().catch((error) => {
      if (this.activo === this.local) throw error;
      this.logger.warn(`No se pudo preparar ${CONSTANTS.UPLOAD_PATH}: ${String(error)}`);
    });
  }

  async guardarDefinitivo(
    origen: string | Buffer,
    userId: string,
    documentId: string,
    tipo: TipoDocumento,
  ): Promise<string> {
    const clave = `${userId}/${documentId}.${EXTENSION[tipo]}`;
    try {
      await this.activo.guardar(clave, origen, MIME_POR_TIPO[tipo]);
      // El procesamiento y la primera apertura ya no tienen que bajarlo de S3.
      const enCache = this.enCache(this.activo, clave);
      if (enCache && Buffer.isBuffer(origen)) this.guardarCopia(enCache, origen);
    } catch (error) {
      throw this.respuestaPara(error, clave);
    } finally {
      if (typeof origen === 'string') await rm(origen, { force: true });
    }
    return clave;
  }

  async tamano(clave: string): Promise<number> {
    return this.ejecutar(clave, (driver) => this.tamanoCon(driver, clave));
  }

  async abrir(clave: string, rango?: RangoSolicitado): Promise<ArchivoAbierto> {
    return this.ejecutar(clave, async (driver) => {
      const tamano = await this.tamanoCon(driver, clave);
      const inicio = rango ? Math.min(rango.inicio, tamano - 1) : 0;
      const fin = rango ? Math.min(rango.fin, tamano - 1) : tamano - 1;
      const tramo = rango ? { inicio, fin } : undefined;

      const enCache = this.enCache(driver, clave);
      if (enCache) {
        const copia = await this.cache.abrir(enCache.id, enCache.extension, tramo);
        if (copia) return { flujo: copia.flujo, tamano, inicio, fin, esParcial: rango !== undefined };
        // Este rango sale de S3; los siguientes, de la copia que se baja en segundo plano.
        this.copiarEnSegundoPlano(driver, clave, enCache);
      }

      const flujo = await driver.abrir(clave, tramo);
      return { flujo, tamano, inicio, fin, esParcial: rango !== undefined };
    });
  }

  async leer(clave: string): Promise<Buffer> {
    return this.ejecutar(clave, async (driver) => {
      const enCache = this.enCache(driver, clave);
      const copia = enCache && (await this.cache.abrir(enCache.id, enCache.extension));
      if (copia) return Buffer.concat(await copia.flujo.toArray());

      const contenido = await driver.leer(clave);
      if (enCache) this.guardarCopia(enCache, contenido);
      return contenido;
    });
  }

  async eliminar(clave: string | null): Promise<void> {
    if (!clave) return;
    await this.ejecutar(clave, async (driver) => {
      // La copia se va con el libro: borrado significa fuera de la BD y de todo almacenamiento.
      const enCache = this.enCache(driver, clave);
      if (enCache) await this.cache.eliminar(enCache.id, enCache.extension);
      this.tamanos.delete(clave);
      await driver.eliminar(clave);
    });
  }

  /** El tamaño de un objeto de S3 no cambia: se pregunta una vez y no en cada rango. */
  private async tamanoCon(driver: ProveedorAlmacenamiento, clave: string): Promise<number> {
    const enCache = this.enCache(driver, clave);
    const local = enCache && (await this.cache.tamano(enCache.id, enCache.extension));
    if (local) return local;

    const conocido = this.tamanos.get(clave);
    if (conocido !== undefined) return conocido;

    const tamano = await driver.tamano(clave);
    if (driver !== this.local) this.tamanos.set(clave, tamano);
    return tamano;
  }

  /** Solo los libros de S3 guardados como `<usuario>/<id>.<ext>` tienen copia en disco. */
  private enCache(driver: ProveedorAlmacenamiento, clave: string): { id: string; extension: string } | null {
    if (driver === this.local || !this.cache.activa) return null;
    const partes = CLAVE_DE_LIBRO.exec(clave);
    return partes ? { id: partes[1], extension: partes[2].toLowerCase() } : null;
  }

  private copiarEnSegundoPlano(
    driver: ProveedorAlmacenamiento,
    clave: string,
    { id, extension }: { id: string; extension: string },
  ): void {
    this.cache
      .descargar(id, extension, () => driver.abrir(clave))
      .catch((error) => this.logger.warn(`No se pudo copiar "${clave}" a la caché: ${String(error)}`));
  }

  // La caché acelera, no es necesaria: si falla, se sigue leyendo de S3.
  private guardarCopia({ id, extension }: { id: string; extension: string }, contenido: Buffer): void {
    this.cache
      .guardar(id, extension, contenido)
      .catch((error) => this.logger.warn(`No se pudo guardar ${id}.${extension} en la caché: ${String(error)}`));
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

  private async ejecutar<T>(clave: string, operacion: (driver: ProveedorAlmacenamiento) => Promise<T>): Promise<T> {
    try {
      return await operacion(await this.driverPara(clave));
    } catch (error) {
      throw this.respuestaPara(error, clave);
    }
  }

  // Los libros subidos antes de Neon (y el temporal de Multer) siguen en disco aunque el driver sea s3.
  private async driverPara(clave: string): Promise<ProveedorAlmacenamiento> {
    if (this.activo === this.local) return this.local;
    if (isAbsolute(clave) || clave.includes('\\') || (await this.local.existe(clave))) return this.local;
    return this.activo;
  }

  private respuestaPara(error: unknown, clave: string): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof ArchivoNoEncontradoError) {
      this.logger.warn(`El archivo "${clave}" no existe en el almacenamiento.`);
      return new NotFoundException(MENSAJE_NO_ENCONTRADO);
    }
    const detalle = error instanceof AlmacenamientoNoDisponibleError ? error.message : String(error);
    this.logger.error(`Almacenamiento no disponible con "${clave}": ${detalle}`);
    return new ServiceUnavailableException(MENSAJE_NO_DISPONIBLE);
  }

  private elegirDriver(configS3: ConfigS3): DriverAlmacenamiento {
    if (CONSTANTS.STORAGE_DRIVER) return CONSTANTS.STORAGE_DRIVER;
    return variablesS3Faltantes(configS3).length ? 'local' : 's3';
  }

  private configS3(): ConfigS3 {
    return {
      endpoint: CONSTANTS.AWS_ENDPOINT_URL_S3,
      region: CONSTANTS.AWS_REGION,
      accessKeyId: CONSTANTS.AWS_ACCESS_KEY_ID,
      secretAccessKey: CONSTANTS.AWS_SECRET_ACCESS_KEY,
      bucket: CONSTANTS.S3_BUCKET,
      forcePathStyle: CONSTANTS.S3_FORCE_PATH_STYLE,
    };
  }
}
