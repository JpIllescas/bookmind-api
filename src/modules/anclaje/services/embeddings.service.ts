import { Injectable, Logger } from '@nestjs/common';

import { CONSTANTS } from '../../../common/configuration/constants';

type Extractor = (
  textos: string[],
  opciones: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

/** Cuántos textos se embeben por lote. Más grande satura la memoria. */
const LOTE = 32;

/**
 * Embeddings locales con transformers.js (pieza 2).
 *
 * Corre en CPU, sin API externa: el texto del libro nunca sale del servidor,
 * que es lo que sostiene la promesa de aislamiento del documento académico.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private extractor?: Extractor;
  private cargando?: Promise<Extractor>;

  /**
   * Carga el modelo la primera vez que se usa.
   *
   * La primera llamada descarga ~100 MB y tarda unos segundos; las siguientes
   * lo toman de `.cache`. Se guarda la promesa para que dos subidas
   * simultáneas no disparen dos descargas.
   */
  private async obtenerExtractor(): Promise<Extractor> {
    if (this.extractor) return this.extractor;

    this.cargando ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = './.cache';

      this.logger.log(`Cargando modelo de embeddings ${CONSTANTS.EMBEDDING_MODEL}…`);
      const inicio = Date.now();

      const extractor = (await pipeline(
        'feature-extraction',
        CONSTANTS.EMBEDDING_MODEL,
      )) as unknown as Extractor;

      this.logger.log(`Modelo listo en ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
      this.extractor = extractor;
      return extractor;
    })();

    return this.cargando;
  }

  /**
   * Embebe fragmentos del libro.
   *
   * El prefijo `passage:` no es opcional: los modelos e5 se entrenaron con él
   * y omitirlo degrada la similitud de forma notable.
   */
  embeberPasajes(textos: string[]): Promise<number[][]> {
    return this.embeber(textos, 'passage: ');
  }

  /** Embebe afirmaciones a verificar. Los e5 usan `query:` para el otro lado. */
  embeberConsultas(textos: string[]): Promise<number[][]> {
    return this.embeber(textos, 'query: ');
  }

  private async embeber(textos: string[], prefijo: string): Promise<number[][]> {
    if (textos.length === 0) return [];

    const extractor = await this.obtenerExtractor();
    const vectores: number[][] = [];

    for (let i = 0; i < textos.length; i += LOTE) {
      const lote = textos.slice(i, i + LOTE).map((t) => prefijo + t);
      const salida = await extractor(lote, { pooling: 'mean', normalize: true });
      vectores.push(...salida.tolist());
    }

    return vectores;
  }

  /**
   * Similitud coseno. Los vectores vienen normalizados del modelo, así que el
   * producto punto ya es el coseno.
   */
  static coseno(a: number[], b: number[]): number {
    let producto = 0;
    for (let i = 0; i < a.length; i += 1) producto += a[i] * b[i];
    return producto;
  }

  /** Vector promedio, renormalizado: la huella semántica del documento. */
  static promedio(vectores: number[][]): number[] {
    if (vectores.length === 0) return [];

    const suma = new Array<number>(vectores[0].length).fill(0);
    for (const vector of vectores) {
      for (let i = 0; i < vector.length; i += 1) suma[i] += vector[i];
    }

    const norma = Math.hypot(...suma);
    return norma === 0 ? suma : suma.map((v) => v / norma);
  }
}
