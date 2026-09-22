import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { CONSTANTS } from '../../../common/configuration/constants';
import { MetricasLlmService } from '../services/metricas-llm.service';
import { LlmProvider, PeticionLlm } from './llm-provider.interface';

/** Un reintento: en el nivel gratuito cada intento gasta cuota diaria. */
const ESPERAS_MS = [2000];

/** Con 4000 un resumen por capítulos se cortaba; el modelo admite bastante más. */
const MAX_TOKENS_POR_DEFECTO = 8192;

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly nombre = `gemini:${CONSTANTS.GEMINI_MODEL}`;

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly cliente = new GoogleGenAI({ apiKey: CONSTANTS.GEMINI_API_KEY });

  constructor(private readonly metricas: MetricasLlmService) {}

  async responder(peticion: PeticionLlm): Promise<string> {
    for (let intento = 0; ; intento += 1) {
      const arranque = Date.now();

      try {
        const texto = await this.pedir(peticion);
        this.metricas.anotar('ok', Date.now() - arranque);
        return texto;
      } catch (error) {
        const ultimo = intento >= ESPERAS_MS.length;

        if (ultimo || !this.esSaturacion(error)) {
          const fallo = this.comoExcepcion(error);
          this.metricas.anotar(
            this.tipoDeFallo(error),
            Date.now() - arranque,
            fallo.message,
          );
          throw fallo;
        }

        this.metricas.anotarReintento();

        const espera = ESPERAS_MS[intento];

        this.logger.warn(
          `Gemini saturado (intento ${intento + 1} de ${ESPERAS_MS.length + 1}); ` +
            `reintento en ${espera} ms.`,
        );

        // Jitter: si varios alumnos preguntan a la vez, no reintentan todos juntos.
        await new Promise((listo) => setTimeout(listo, espera + Math.random() * 300));
      }
    }
  }

  /** Trozos según llegan del modelo; el estudiante ve la respuesta formarse. */
  async *responderStream(peticion: PeticionLlm): AsyncIterable<string> {
    for (let intento = 0; ; intento += 1) {
      const arranque = Date.now();
      let entregado = false;

      try {
        const flujo = await this.cliente.models.generateContentStream(this.parametros(peticion));

        for await (const trozo of flujo) {
          const texto = trozo.text;
          if (texto) {
            entregado = true;
            yield texto;
          }
        }

        if (!entregado) {
          throw new ServiceUnavailableException(
            'El asistente no pudo generar una respuesta para esa pregunta. Intenta reformularla.',
          );
        }

        this.metricas.anotar('ok', Date.now() - arranque);
        return;
      } catch (error) {
        // Cancelado por el estudiante: no es un fallo del modelo.
        if (peticion.senal?.aborted) return;

        // Solo se reintenta si aún no salió texto: repetir a medias duplicaría la respuesta.
        const reintentable =
          !entregado && intento < ESPERAS_MS.length && this.esSaturacion(error);

        if (!reintentable) {
          const fallo = this.comoExcepcion(error);
          this.metricas.anotar(this.tipoDeFallo(error), Date.now() - arranque, fallo.message);
          throw fallo;
        }

        this.metricas.anotarReintento();
        this.logger.warn(`Gemini saturado en streaming; reintento en ${ESPERAS_MS[intento]} ms.`);
        await new Promise((listo) => setTimeout(listo, ESPERAS_MS[intento] + Math.random() * 300));
      }
    }
  }

  private parametros(peticion: PeticionLlm) {
    return {
      model: CONSTANTS.GEMINI_MODEL,
      contents: [
        ...peticion.historial.map((turno) => ({
          role: turno.rol === 'user' ? ('user' as const) : ('model' as const),
          parts: [{ text: turno.contenido }],
        })),
        { role: 'user' as const, parts: [{ text: peticion.mensaje }] },
      ],
      config: {
        systemInstruction: peticion.systemPrompt,
        temperature: 0.3,
        maxOutputTokens: peticion.maxTokens ?? MAX_TOKENS_POR_DEFECTO,
        abortSignal: peticion.senal,
      },
    };
  }

  private async pedir(peticion: PeticionLlm): Promise<string> {
    const respuesta = await this.cliente.models.generateContent(this.parametros(peticion));

    const texto = respuesta.text?.trim();

    if (!texto) {
      this.logger.warn(
        `Gemini devolvió una respuesta vacía. Motivo: ${
          respuesta.candidates?.[0]?.finishReason ?? 'desconocido'
        }`,
      );

      throw new ServiceUnavailableException(
        'El asistente no pudo generar una respuesta para esa pregunta. Intenta reformularla.',
      );
    }

    return texto;
  }

  private tipoDeFallo(error: unknown): 'saturado' | 'cuota' | 'error' {
    const mensaje = error instanceof Error ? error.message : String(error);

    if (this.esSaturacion(error)) return 'saturado';
    if (mensaje.includes('429') || mensaje.toLowerCase().includes('quota')) return 'cuota';

    return 'error';
  }

  /** Falta de capacidad del modelo: eso sí se arregla esperando. La cuota no. */
  private esSaturacion(error: unknown): boolean {
    if (error instanceof ServiceUnavailableException) return false;

    const mensaje = error instanceof Error ? error.message : String(error);

    return (
      mensaje.includes('503') ||
      mensaje.includes('UNAVAILABLE') ||
      mensaje.includes('500') ||
      mensaje.toLowerCase().includes('overloaded')
    );
  }

  /** Traduce el fallo de la API a algo que el estudiante pueda entender. */
  private comoExcepcion(error: unknown): ServiceUnavailableException {
    if (error instanceof ServiceUnavailableException) return error;

    const mensaje = error instanceof Error ? error.message : String(error);
    this.logger.error(`Fallo al llamar a Gemini: ${mensaje}`);

    if (mensaje.includes('429') || mensaje.toLowerCase().includes('quota')) {
      return new ServiceUnavailableException(
        'Se alcanzó el límite de peticiones del asistente. Espera un momento.',
      );
    }

    if (this.esSaturacion(error)) {
      return new ServiceUnavailableException(
        'El modelo está saturado ahora mismo. Vuelve a intentarlo en unos segundos.',
      );
    }

    return new ServiceUnavailableException(
      'El asistente no está disponible en este momento.',
    );
  }
}
