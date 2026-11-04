import { Injectable, OnModuleDestroy } from '@nestjs/common';

import { CONSTANTS } from '../../../common/configuration/constants';
import { ColaEmbeddings } from './cola-embeddings';
import { HiloEmbeddings } from './hilo-embeddings';

/** Lotes chicos para el indexado: una consulta espera como mucho uno. Las consultas son pocas frases. */
const LOTES = { indexado: 8, consulta: 32 };

/** Embeddings locales (pieza 2) en CPU: el texto nunca sale del servidor. */
@Injectable()
export class EmbeddingsService implements OnModuleDestroy {
  private readonly hilo = new HiloEmbeddings({
    modelo: CONSTANTS.EMBEDDING_MODEL,
    hilos: CONSTANTS.EMBEDDINGS_HILOS,
    cacheDir: './.cache',
  });
  private readonly cola = new ColaEmbeddings(this.hilo, LOTES);

  /** Embebe fragmentos del libro. Los modelos e5 esperan el prefijo `passage:`. */
  embeberPasajes(textos: string[]): Promise<number[][]> {
    return this.cola.embeber(textos.map((t) => 'passage: ' + t), 'indexado');
  }

  /** Embebe afirmaciones a verificar. Los e5 usan `query:` para el otro lado. */
  embeberConsultas(textos: string[]): Promise<number[][]> {
    return this.cola.embeber(textos.map((t) => 'query: ' + t), 'consulta');
  }

  onModuleDestroy(): Promise<void> {
    return this.hilo.terminar();
  }

  /** Similitud coseno; los vectores ya vienen normalizados del modelo. */
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
