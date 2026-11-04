import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONES = new Set(['pdf', 'epub']);
const TEMPORAL = '.parcial';

export interface CopiaAbierta {
  flujo: Readable;
  tamano: number;
}

/**
 * Copia en disco de los libros que viven en S3: el visor pide decenas de rangos
 * por página y desde el disco cada uno sale en milisegundos. Los archivos se
 * llaman `<id del documento>.<extensión>`; si se pasa del tope, se borran los
 * menos usados.
 */
export class CacheLibros {
  private readonly descargas = new Map<string, Promise<void>>();

  constructor(
    private readonly raiz: string,
    private readonly maximoBytes: number,
  ) {}

  get activa(): boolean {
    return this.maximoBytes > 0;
  }

  /** Abre la copia si existe; null si todavía no está. */
  async abrir(id: string, extension: string, rango?: { inicio: number; fin: number }): Promise<CopiaAbierta | null> {
    const ruta = this.ruta(id, extension);
    const datos = await stat(ruta).catch(() => null);
    if (!datos) return null;

    // La fecha de modificación marca el último uso: es lo que mira el recorte.
    const ahora = new Date();
    await utimes(ruta, ahora, ahora).catch(() => undefined);
    return { flujo: createReadStream(ruta, rango ? { start: rango.inicio, end: rango.fin } : undefined), tamano: datos.size };
  }

  async tamano(id: string, extension: string): Promise<number | null> {
    const datos = await stat(this.ruta(id, extension)).catch(() => null);
    return datos?.size ?? null;
  }

  /** Escribe en un temporal y lo renombra al final: nunca queda a la vista una copia a medias. */
  async guardar(id: string, extension: string, origen: Buffer | Readable): Promise<void> {
    if (!this.activa) return;
    const ruta = this.ruta(id, extension);
    const temporal = `${ruta}.${randomUUID()}${TEMPORAL}`;

    await mkdir(this.raiz, { recursive: true });
    try {
      await pipeline(Buffer.isBuffer(origen) ? Readable.from([origen]) : origen, createWriteStream(temporal));
      await rename(temporal, ruta);
    } catch (error) {
      await rm(temporal, { force: true });
      throw error;
    }
    await this.recortar(ruta);
  }

  /** Una sola descarga por libro aunque lo abran varios a la vez. */
  descargar(id: string, extension: string, origen: () => Promise<Readable>): Promise<void> {
    const ruta = this.ruta(id, extension);
    const enCurso = this.descargas.get(ruta);
    if (enCurso) return enCurso;

    const descarga = (async () => {
      if (await this.tamano(id, extension)) return;
      await this.guardar(id, extension, await origen());
    })().finally(() => this.descargas.delete(ruta));

    this.descargas.set(ruta, descarga);
    return descarga;
  }

  async eliminar(id: string, extension: string): Promise<void> {
    await rm(this.ruta(id, extension), { force: true });
  }

  /** Borra los menos usados hasta quedar bajo el tope; el recién guardado se queda salvo que solo él lo pase. */
  private async recortar(recien: string): Promise<void> {
    const nombres = await readdir(this.raiz).catch(() => [] as string[]);
    const archivos = await Promise.all(
      nombres
        .filter((nombre) => !nombre.endsWith(TEMPORAL))
        .map(async (nombre) => {
          const ruta = join(this.raiz, nombre);
          const datos = await stat(ruta).catch(() => null);
          return datos ? { ruta, tamano: datos.size, uso: datos.mtimeMs } : null;
        }),
    );

    const vigentes = archivos.filter((a): a is NonNullable<typeof a> => a !== null).sort((a, b) => a.uso - b.uso);
    let total = vigentes.reduce((suma, a) => suma + a.tamano, 0);

    for (const archivo of vigentes) {
      if (total <= this.maximoBytes) break;
      if (archivo.ruta === recien) continue;
      await rm(archivo.ruta, { force: true });
      total -= archivo.tamano;
    }
    // Un libro más grande que todo el tope no se guarda: se sigue leyendo de S3.
    if (total > this.maximoBytes) await rm(recien, { force: true });
  }

  private ruta(id: string, extension: string): string {
    // Solo ids de documento: así un nombre de archivo nunca puede salirse de la carpeta.
    if (!UUID.test(id) || !EXTENSIONES.has(extension)) {
      throw new Error(`"${id}.${extension}" no es un id de documento válido para la caché.`);
    }
    return join(this.raiz, `${id.toLowerCase()}.${extension}`);
  }
}
