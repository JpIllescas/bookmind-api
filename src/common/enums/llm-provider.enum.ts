/** Motor conversacional (pieza 1). */
export enum ProveedorLlm {
  Gemini = 'gemini',
  Ollama = 'ollama',
  /** Respuestas simuladas: desarrollar sin API key ni GPU. */
  Mock = 'mock',
}
