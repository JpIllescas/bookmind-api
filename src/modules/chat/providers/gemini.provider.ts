import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { CONSTANTS } from '../../../common/configuration/constants';
import { LlmProvider, PeticionLlm } from './llm-provider.interface';

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly nombre = `gemini:${CONSTANTS.GEMINI_MODEL}`;

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly cliente = new GoogleGenAI({ apiKey: CONSTANTS.GEMINI_API_KEY });

  async responder(peticion: PeticionLlm): Promise<string> {
    try {
      const respuesta = await this.cliente.models.generateContent({
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
          // Con 1200 un resumen de libro se cortaba a media frase.
          maxOutputTokens: 4000,
        },
      });

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
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      const mensaje = error instanceof Error ? error.message : String(error);
      this.logger.error(`Fallo al llamar a Gemini: ${mensaje}`);

      if (mensaje.includes('429') || mensaje.toLowerCase().includes('quota')) {
        throw new ServiceUnavailableException(
          'Se alcanzó el límite de peticiones del asistente. Espera un momento.',
        );
      }

      throw new ServiceUnavailableException(
        'El asistente no está disponible en este momento.',
      );
    }
  }
}
