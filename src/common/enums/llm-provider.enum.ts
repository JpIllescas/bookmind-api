/** Motor conversacional (pieza 1). */
export enum ProveedorLlm {
  Gemini = 'gemini',
  Ollama = 'ollama',
  /** Sin modelo de lenguaje: todo sale del motor propio, sin respuestas inventadas. */
  Mock = 'mock',
}
