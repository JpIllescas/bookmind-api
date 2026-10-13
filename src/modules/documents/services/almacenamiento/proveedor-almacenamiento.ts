import { Readable } from 'node:stream';

export type DriverAlmacenamiento = 'local' | 's3';

/** Lo que cada driver sabe hacer con la clave de un archivo; la fachada decide cuál usar. */
export interface ProveedorAlmacenamiento {
  readonly nombre: DriverAlmacenamiento;
  /** `origen` puede ser el archivo en memoria o una ruta temporal en disco. */
  guardar(clave: string, origen: Buffer | string, mime: string): Promise<void>;
  tamano(clave: string): Promise<number>;
  /** Abre desde `inicio` hasta `fin` inclusive, o todo el archivo si no hay rango. */
  abrir(clave: string, rango?: { inicio: number; fin: number }): Promise<Readable>;
  leer(clave: string): Promise<Buffer>;
  eliminar(clave: string): Promise<void>;
}

/** El objeto no existe: el estudiante tiene que volver a subir el libro. */
export class ArchivoNoEncontradoError extends Error {
  constructor(readonly clave: string) {
    super(`No existe el archivo "${clave}".`);
    this.name = 'ArchivoNoEncontradoError';
  }
}

/** Falta configuración o el almacenamiento no responde: no es culpa del archivo. */
export class AlmacenamientoNoDisponibleError extends Error {
  constructor(mensaje: string, options?: { cause?: unknown }) {
    super(mensaje, options);
    this.name = 'AlmacenamientoNoDisponibleError';
  }
}
