/** Contrato del motor conversacional (pieza 1). */
export interface LlmProvider {
  /** Nombre para logs y para /health. */
  readonly nombre: string;

  /** Devuelve la respuesta del modelo al mensaje del estudiante. */
  responder(peticion: PeticionLlm): Promise<string>;
}

export interface PeticionLlm {
  /** Instrucciones y libro completo. */
  systemPrompt: string;
  /** Turnos previos, del más antiguo al más reciente. */
  historial: TurnoConversacion[];
  mensaje: string;
}

export interface TurnoConversacion {
  rol: 'user' | 'assistant';
  contenido: string;
}

/** Token de inyección: el módulo resuelve la implementación según el .env. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
