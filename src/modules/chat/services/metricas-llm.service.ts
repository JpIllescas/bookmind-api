import { Injectable } from '@nestjs/common';

import { CONSTANTS } from '../../../common/configuration/constants';
import { ProveedorLlm } from '../../../common/enums/llm-provider.enum';

export type ResultadoLlamada = 'ok' | 'saturado' | 'cuota' | 'error';

export interface RegistroLlamada {
  instante: number;
  ms: number;
  resultado: ResultadoLlamada;
  mensaje?: string;
}

/** En memoria: al reiniciar el servidor el historial empieza de cero. */
const MAXIMO_REGISTROS = 200;

/** Ventana de la que se calculan los porcentajes. */
const VENTANA_MS = 60 * 60 * 1000;

/** Llamadas que se devuelven para la gráfica. */
const PARA_GRAFICA = 40;

/** Lo que le ocurre a las llamadas al modelo; el proveedor no publica su carga. */
@Injectable()
export class MetricasLlmService {
  private readonly registros: RegistroLlamada[] = [];
  private reintentos = 0;

  anotar(resultado: ResultadoLlamada, ms: number, mensaje?: string): void {
    this.registros.push({ instante: Date.now(), ms, resultado, mensaje });

    if (this.registros.length > MAXIMO_REGISTROS) this.registros.shift();
  }

  anotarReintento(): void {
    this.reintentos += 1;
  }

  resumen() {
    const desde = Date.now() - VENTANA_MS;
    const ventana = this.registros.filter((r) => r.instante >= desde);

    const cuenta = (resultado: ResultadoLlamada) =>
      ventana.filter((r) => r.resultado === resultado).length;

    const correctas = ventana.filter((r) => r.resultado === 'ok');
    const latencias = correctas.map((r) => r.ms).sort((a, b) => a - b);
    const ultimo = this.registros[this.registros.length - 1];
    const ultimoFallo = [...this.registros].reverse().find((r) => r.resultado !== 'ok');

    return {
      proveedor: CONSTANTS.LLM_PROVIDER,
      modelo:
        CONSTANTS.LLM_PROVIDER === ProveedorLlm.Gemini
          ? CONSTANTS.GEMINI_MODEL
          : CONSTANTS.LLM_PROVIDER,
      simulado: CONSTANTS.LLM_PROVIDER === ProveedorLlm.Mock,
      estado: this.estado(ultimo),
      ventanaMinutos: VENTANA_MS / 60_000,
      llamadas: ventana.length,
      exitosas: correctas.length,
      saturaciones: cuenta('saturado'),
      cuotaAgotada: cuenta('cuota'),
      errores: cuenta('error'),
      reintentos: this.reintentos,
      latenciaMediaMs: this.media(latencias),
      // Mediana y p95: una llamada lenta no debe disfrazar el resto.
      latenciaMedianaMs: this.percentil(latencias, 0.5),
      latenciaP95Ms: this.percentil(latencias, 0.95),
      ultimaLlamada: ultimo ? new Date(ultimo.instante).toISOString() : null,
      ultimoFallo: ultimoFallo
        ? {
            cuando: new Date(ultimoFallo.instante).toISOString(),
            resultado: ultimoFallo.resultado,
            mensaje: ultimoFallo.mensaje ?? null,
          }
        : null,
      recientes: ventana.slice(-PARA_GRAFICA).map((r) => ({
        instante: new Date(r.instante).toISOString(),
        ms: r.ms,
        resultado: r.resultado,
      })),
    };
  }

  /** El estado lo marca la última llamada: es lo que vería el alumno ahora. */
  private estado(ultimo: RegistroLlamada | undefined): string {
    if (CONSTANTS.LLM_PROVIDER === ProveedorLlm.Mock) return 'simulado';
    if (!ultimo) return 'sin_datos';

    return {
      ok: 'operativo',
      saturado: 'saturado',
      cuota: 'sin_cuota',
      error: 'con_fallos',
    }[ultimo.resultado];
  }

  private media(ordenadas: number[]): number | null {
    if (ordenadas.length === 0) return null;

    return Math.round(ordenadas.reduce((suma, ms) => suma + ms, 0) / ordenadas.length);
  }

  private percentil(ordenadas: number[], parte: number): number | null {
    if (ordenadas.length === 0) return null;

    const indice = Math.min(
      Math.floor(ordenadas.length * parte),
      ordenadas.length - 1,
    );

    return ordenadas[indice];
  }
}
