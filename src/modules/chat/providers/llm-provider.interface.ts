/** Contrato del motor conversacional (pieza 1). */
export interface LlmProvider {
  /** Nombre para logs y para /health. */
  readonly nombre: string;

  /** Devuelve la respuesta del modelo al mensaje del estudiante. */
  responder(peticion: PeticionLlm): Promise<string>;

  /**
   * Entrega la respuesta por trozos según la produce el modelo.
   * Opcional: quien no lo implemente recibe la respuesta completa en un solo trozo.
   */
  responderStream?(peticion: PeticionLlm): AsyncIterable<string>;
}

export interface PeticionLlm {
  /** Instrucciones y libro completo. */
  systemPrompt: string;
  /** Turnos previos, del más antiguo al más reciente. */
  historial: TurnoConversacion[];
  mensaje: string;
  /** Permite cortar la generación si el estudiante cierra el chat. */
  senal?: AbortSignal;
  /** Techo de salida; los materiales largos necesitan más que una respuesta de chat. */
  maxTokens?: number;
}

export interface TurnoConversacion {
  rol: 'user' | 'assistant';
  contenido: string;
}

/** Token de inyección: el módulo resuelve la implementación según el .env. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** Stream para proveedores sin soporte nativo: un único trozo con toda la respuesta. */
export async function* streamDesdeRespuesta(
  proveedor: LlmProvider,
  peticion: PeticionLlm,
): AsyncIterable<string> {
  yield await proveedor.responder(peticion);
}
