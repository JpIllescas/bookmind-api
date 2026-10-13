import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../../common/configuration/constants';
import { ProveedorLlm } from '../../../common/enums/llm-provider.enum';
import { LlamadaLlm } from '../entities/llamada-llm.entity';

export type ResultadoLlamada = 'ok' | 'saturado' | 'cuota' | 'error';

export interface RegistroLlamada {
  instante: number;
  ms: number;
  resultado: ResultadoLlamada;
  mensaje?: string;
}

/** En memoria para la pantalla en vivo; el histórico completo queda en llm_calls. */
const MAXIMO_REGISTROS = 200;

/** Ventana de la que se calculan los porcentajes. */
const VENTANA_MS = 60 * 60 * 1000;

/** Llamadas que se devuelven para la gráfica. */
const PARA_GRAFICA = 40;

/** Lo que le ocurre a las llamadas al modelo; el proveedor no publica su carga. */
@Injectable()
export class MetricasLlmService {
  private readonly logger = new Logger(MetricasLlmService.name);
  private readonly registros: RegistroLlamada[] = [];
  private reintentos = 0;

  constructor(
    @InjectRepository(LlamadaLlm)
    private readonly llamadas: Repository<LlamadaLlm>,
  ) {}

  anotar(resultado: ResultadoLlamada, ms: number, mensaje?: string): void {
    this.registros.push({ instante: Date.now(), ms, resultado, mensaje });

    if (this.registros.length > MAXIMO_REGISTROS) this.registros.shift();

    // Sin await: guardar la métrica no debe demorar ni tumbar la respuesta al estudiante.
    this.llamadas
      .insert({
        proveedor: CONSTANTS.LLM_PROVIDER,
        modelo: this.modelo(),
        ms,
        resultado,
        mensaje: mensaje ?? null,
      })
      .catch((error: Error) =>
        this.logger.warn(
          `No se pudo guardar la llamada al modelo: ${error.message}`,
        ),
      );
  }

  /** Todo lo guardado en llm_calls: latencia de las correctas y fallos por tipo. */
  async historico() {
    const [fila] = await this.llamadas.query<
      Array<Record<string, number | string | null>>
    >(
      `SELECT count(*)::int AS llamadas,
              count(*) FILTER (WHERE resultado = 'ok')::int AS exitosas,
              count(*) FILTER (WHERE resultado = 'saturado')::int AS saturaciones,
              count(*) FILTER (WHERE resultado = 'cuota')::int AS "cuotaAgotada",
              count(*) FILTER (WHERE resultado = 'error')::int AS errores,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY ms) FILTER (WHERE resultado = 'ok') AS "latenciaMedianaMs",
              percentile_disc(0.95) WITHIN GROUP (ORDER BY ms) FILTER (WHERE resultado = 'ok') AS "latenciaP95Ms",
              min(instante) AS desde
         FROM llm_calls`,
    );

    return fila;
  }

  anotarReintento(): void {
    this.reintentos += 1;
  }

  async resumen() {
    const desde = Date.now() - VENTANA_MS;
    const ventana = this.registros.filter((r) => r.instante >= desde);

    const cuenta = (resultado: ResultadoLlamada) =>
      ventana.filter((r) => r.resultado === resultado).length;

    const correctas = ventana.filter((r) => r.resultado === 'ok');
    const latencias = correctas.map((r) => r.ms).sort((a, b) => a - b);
    const ultimo = this.registros[this.registros.length - 1];
    const ultimoFallo = [...this.registros]
      .reverse()
      .find((r) => r.resultado !== 'ok');

    return {
      proveedor: CONSTANTS.LLM_PROVIDER,
      modelo: this.modelo(),
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
      historico: await this.historico(),
    };
  }

  private modelo(): string {
    return CONSTANTS.LLM_PROVIDER === ProveedorLlm.Gemini
      ? CONSTANTS.GEMINI_MODEL
      : CONSTANTS.LLM_PROVIDER;
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

    return Math.round(
      ordenadas.reduce((suma, ms) => suma + ms, 0) / ordenadas.length,
    );
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
