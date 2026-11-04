import { Logger } from '@nestjs/common';
import { Worker } from 'node:worker_threads';

import { MotorEmbeddings } from './cola-embeddings';

export interface OpcionesHilo {
  modelo: string;
  hilos: number;
  cacheDir: string;
}

// Código en línea y no un .js aparte: así arranca igual desde dist, ts-node (mediciones) y Jest.
const CODIGO_DEL_HILO = `
const { parentPort, workerData } = require('node:worker_threads');
let extractor;

async function cargar() {
  const inicio = Date.now();
  const { pipeline, env } = require(workerData.biblioteca);
  env.cacheDir = workerData.cacheDir;
  const listo = await pipeline('feature-extraction', workerData.modelo, {
    session_options: { intraOpNumThreads: workerData.hilos, interOpNumThreads: 1 },
  });
  parentPort.postMessage({ cargado: Date.now() - inicio });
  return listo;
}

parentPort.on('message', async ({ id, textos }) => {
  try {
    extractor ??= cargar();
    const salida = await (await extractor)(textos, { pooling: 'mean', normalize: true });
    parentPort.postMessage({ id, vectores: salida.tolist() });
  } catch (error) {
    extractor = undefined;
    parentPort.postMessage({ id, error: String((error && error.message) || error) });
  }
});
`;

type Respuesta = { id: number; vectores?: number[][]; error?: string } | { cargado: number };

interface Espera {
  resolver: (vectores: number[][]) => void;
  rechazar: (error: Error) => void;
}

/**
 * El modelo e5 vive solo en este hilo: mientras calcula, el hilo principal
 * sigue atendiendo peticiones. Si el hilo muere, el siguiente pedido lo levanta.
 */
export class HiloEmbeddings implements MotorEmbeddings {
  private readonly logger = new Logger(HiloEmbeddings.name);
  private hilo?: Worker;
  private siguienteId = 0;
  private readonly enEspera = new Map<number, Espera>();

  constructor(private readonly opciones: OpcionesHilo) {}

  embeber(textos: string[]): Promise<number[][]> {
    const hilo = this.obtenerHilo();
    const id = this.siguienteId++;
    return new Promise((resolver, rechazar) => {
      this.enEspera.set(id, { resolver, rechazar });
      hilo.ref();
      hilo.postMessage({ id, textos });
    });
  }

  async terminar(): Promise<void> {
    const hilo = this.hilo;
    this.hilo = undefined;
    await hilo?.terminate();
  }

  private obtenerHilo(): Worker {
    if (this.hilo) return this.hilo;

    this.logger.log(
      `Cargando modelo de embeddings ${this.opciones.modelo} en un hilo aparte ` +
        `(${this.opciones.hilos} ${this.opciones.hilos === 1 ? 'hilo' : 'hilos'} de cálculo)…`,
    );
    const hilo = new Worker(CODIGO_DEL_HILO, {
      eval: true,
      workerData: { ...this.opciones, biblioteca: require.resolve('@huggingface/transformers') },
    });

    hilo.on('message', (respuesta: Respuesta) => {
      if ('cargado' in respuesta) {
        this.logger.log(`Modelo listo en ${(respuesta.cargado / 1000).toFixed(1)}s.`);
        return;
      }
      const espera = this.enEspera.get(respuesta.id);
      this.enEspera.delete(respuesta.id);
      // Sin pedidos pendientes, el hilo no debe impedir que el proceso termine.
      if (this.enEspera.size === 0) hilo.unref();
      if (respuesta.error) espera?.rechazar(new Error(respuesta.error));
      else espera?.resolver(respuesta.vectores ?? []);
    });
    hilo.on('error', (error) => this.descartar(hilo, error));
    hilo.on('exit', (codigo) =>
      this.descartar(hilo, new Error(`El hilo de embeddings terminó (código ${codigo}).`)),
    );

    this.hilo = hilo;
    return hilo;
  }

  private descartar(hilo: Worker, error: Error): void {
    if (this.hilo === hilo) this.hilo = undefined;
    if (this.enEspera.size === 0) return;
    this.logger.error(`Hilo de embeddings caído: ${error.message}`);
    for (const espera of this.enEspera.values()) espera.rechazar(error);
    this.enEspera.clear();
  }
}
