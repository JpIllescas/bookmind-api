/**
 * Origen de un ejemplo de entrenamiento. Ambos son etiquetas humanas:
 * no existe "predicción del modelo" para evitar auto-entrenamiento.
 */
export enum OrigenEjemplo {
  Seed = 'seed',
  UserFeedback = 'user_feedback',
}
