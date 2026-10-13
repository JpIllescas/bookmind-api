import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

import {
  AlmacenamientoNoDisponibleError,
  ArchivoNoEncontradoError,
  ProveedorAlmacenamiento,
} from './proveedor-almacenamiento';

/** Guarda los libros en disco bajo UPLOAD_PATH; también sirve los subidos antes de Neon. */
export class AlmacenamientoLocal implements ProveedorAlmacenamiento {
  readonly nombre = 'local' as const;
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  async prepararRaiz(): Promise<void> {
    await mkdir(this.raiz, { recursive: true });
  }

  async existe(clave: string): Promise<boolean> {
    try {
      return (await stat(this.ruta(clave))).isFile();
    } catch {
      return false;
    }
  }

  async guardar(clave: string, origen: Buffer | string): Promise<void> {
    const destino = this.ruta(clave);
    try {
      await mkdir(dirname(destino), { recursive: true });
      if (Buffer.isBuffer(origen)) {
        await writeFile(destino, origen);
        return;
      }
      await rename(origen, destino).catch(async () => {
        // rename falla si el temporal y la carpeta final están en discos distintos.
        await copyFile(origen, destino);
        await rm(origen, { force: true });
      });
    } catch (error) {
      throw this.traducir(error, clave);
    }
  }

  async tamano(clave: string): Promise<number> {
    try {
      return (await stat(this.ruta(clave))).size;
    } catch (error) {
      throw this.traducir(error, clave);
    }
  }

  async abrir(clave: string, rango?: { inicio: number; fin: number }): Promise<Readable> {
    const ruta = this.ruta(clave);
    // stat primero: createReadStream solo avisa del ENOENT cuando ya se empezó a responder.
    await this.tamano(clave);
    return createReadStream(ruta, rango ? { start: rango.inicio, end: rango.fin } : undefined);
  }

  async leer(clave: string): Promise<Buffer> {
    try {
      return await readFile(this.ruta(clave));
    } catch (error) {
      throw this.traducir(error, clave);
    }
  }

  async eliminar(clave: string): Promise<void> {
    try {
      await rm(this.ruta(clave), { force: true });
    } catch (error) {
      throw this.traducir(error, clave);
    }
  }

  /** Acepta claves con "/" o "\" (los libros viejos de Windows) y rutas absolutas. */
  private ruta(clave: string): string {
    if (isAbsolute(clave)) return clave;

    const ruta = resolve(this.raiz, ...clave.split(/[\\/]+/));
    if (!ruta.startsWith(this.raiz + sep)) {
      throw new ArchivoNoEncontradoError(clave);
    }
    return ruta;
  }

  private traducir(error: unknown, clave: string): Error {
    if (error instanceof ArchivoNoEncontradoError) return error;
    const codigo = (error as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT' || codigo === 'EISDIR') return new ArchivoNoEncontradoError(clave);
    return new AlmacenamientoNoDisponibleError(
      `No se pudo usar el disco (${this.raiz}) con "${clave}": ${String(error)}`,
      { cause: error },
    );
  }
}
