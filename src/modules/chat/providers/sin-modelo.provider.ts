import { ServiceUnavailableException } from '@nestjs/common';

import { LlmProvider, PeticionLlm } from './llm-provider.interface';

const MENSAJE =
  'No hay un modelo de lenguaje configurado: BookMind está respondiendo solo con su motor propio. ' +
  'Para usar Gemini, configura LLM_PROVIDER=gemini y su clave en el .env.';

/**
 * LLM_PROVIDER=mock: sin modelo externo. No inventa respuestas; quien lo llame recibe un error claro,
 * porque con este valor el chat, el asistente y el Studio ya van por el motor propio (usaGemini es falso).
 */
export class SinModeloProvider implements LlmProvider {
  readonly nombre = 'mock';

  // eslint-disable-next-line require-yield
  async *responderStream(_peticion: PeticionLlm): AsyncIterable<string> {
    throw new ServiceUnavailableException(MENSAJE);
  }

  responder(_peticion: PeticionLlm): Promise<string> {
    return Promise.reject(new ServiceUnavailableException(MENSAJE));
  }
}
