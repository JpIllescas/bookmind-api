import { Injectable } from '@nestjs/common';

import { TipoBloque } from '../../../common/enums/tipo-bloque.enum';

/** Materiales que el estudiante puede pedir por chat; el resto es conversación. */
export type MaterialPedido =
  | TipoBloque.Summary
  | TipoBloque.Flashcards
  | TipoBloque.Quiz;

/** Verbos con los que un estudiante pide que le preparen algo. */
const PETICION =
  /\b(hazme|haz|hacer|generame|génerame|genera|generar|creame|créame|crear|dame|quiero|necesito|prepara|preparame|prepárame|arma|armame|ármame|ponme|pon)\b/;

/** Hablar del contenido: aunque nombre un material, no lo está pidiendo. */
const SOBRE_EL_LIBRO =
  /\b(qué es|que es|qué son|que son|qué significa|que significa|qué dice|que dice|por qué|porque|para qué|para que|cómo funciona|como funciona|cuál|cual|dónde|donde|cuándo|cuando|quién|quien|el libro|el autor|el texto|la lectura|menciona|explica)\b/;

const MATERIALES: [RegExp, MaterialPedido][] = [
  [
    /\b(flashcards?|flash cards?|tarjetas?( de (memoria|estudio|repaso))?)\b/,
    TipoBloque.Flashcards,
  ],
  [
    /\b(quiz|cuestionario|test|examen|preguntas de (repaso|práctica|practica))\b/,
    TipoBloque.Quiz,
  ],
  [/\b(resumen|resúmeme|resumeme|resúmelo|resumelo|resumir)\b/, TipoBloque.Summary],
];

/** Sin verbo de petición, solo se acepta un mensaje telegráfico ("ahora flashcards"). */
const PALABRAS_SIN_VERBO = 4;

/**
 * Reconoce cuándo el estudiante pide un material en vez de hacer una pregunta.
 * Es el hueco donde entrará el clasificador de intención entrenado.
 */
@Injectable()
export class IntencionService {
  /** Devuelve los materiales pedidos en el orden en que el estudiante los nombra. */
  detectar(mensaje: string): MaterialPedido[] {
    const texto = mensaje.toLowerCase().trim();

    // Ante la duda, conversación: un falso positivo le quita la pregunta al alumno.
    if (SOBRE_EL_LIBRO.test(texto)) return [];

    const pedidos = MATERIALES.map(([patron, tipo]) => ({
      tipo,
      donde: texto.search(patron),
    }))
      .filter((pedido) => pedido.donde >= 0)
      .sort((uno, otro) => uno.donde - otro.donde);

    if (pedidos.length === 0) return [];

    const breve = texto.split(/\s+/).length <= PALABRAS_SIN_VERBO;

    return PETICION.test(texto) || breve ? pedidos.map((pedido) => pedido.tipo) : [];
  }
}
