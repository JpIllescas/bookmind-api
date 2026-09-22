import { Injectable } from '@nestjs/common';

import { Ejercicio } from '../entities/lesson.entity';

/** Lo que devuelve el motor propio para quiz y flashcards. */
export interface ItemQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
  pagina?: number;
}

export interface ItemFlashcard {
  pregunta: string;
  respuesta: string;
  pagina?: number;
  tipo?: string;
}

export const EJERCICIOS_POR_LECCION = 5;

/** Con más huecos la lección se vuelve monótona aunque sea lo que más produce el motor. */
const MAXIMO_HUECOS = 3;

const HUECO = '_____';
const OPCIONES_HUECO = 4;

/** "¿Qué palabra completa la frase? «...»" y "Completa la frase: «...»". */
const FRASE_ENTRE_COMILLAS = /«([^»]+)»/;

/** Término al que apunta una flashcard de definición o contexto. */
const TERMINO_DE_PREGUNTA = /^¿Qué (?:dice el libro sobre|es|significa) (.+?)\?$/i;

/** Generador determinista: la misma unidad da siempre la misma lección hasta regenerarla. */
function azarDe(semilla: string): () => number {
  let estado = 2166136261;
  for (const caracter of semilla) {
    estado ^= caracter.charCodeAt(0);
    estado = Math.imul(estado, 16777619);
  }
  return () => {
    estado = Math.imul(estado ^ (estado >>> 15), 2246822507);
    estado = Math.imul(estado ^ (estado >>> 13), 3266489909);
    return ((estado ^= estado >>> 16) >>> 0) / 4294967296;
  };
}

function barajar<T>(lista: T[], azar: () => number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function reemplazarTermino(texto: string, termino: string, nuevo: string): string | null {
  const patron = new RegExp(`(?<![\\p{L}\\p{N}])${escapar(termino)}(?![\\p{L}\\p{N}])`, 'iu');
  if (!patron.test(texto)) return null;
  return texto.replace(patron, nuevo);
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convierte quiz y flashcards del motor en los tres tipos de ejercicio de una
 * lección. No llama a nada: se puede probar sin motor ni base de datos.
 */
@Injectable()
export class EjerciciosService {
  armar(
    quiz: ItemQuiz[],
    flashcards: ItemFlashcard[],
    semilla: string,
    cantidad = EJERCICIOS_POR_LECCION,
  ): Ejercicio[] {
    const azar = azarDe(semilla);

    const desdeQuiz = quiz.map((item) => this.desdeQuiz(item)).filter(esEjercicio);
    const opciones = desdeQuiz.filter((e) => e.tipo === 'opcion');
    // El quiz del motor también produce huecos: van al mismo cajón que los de las flashcards.
    const huecos = [
      ...desdeQuiz.filter((e) => e.tipo === 'hueco'),
      ...this.huecosDesdeFlashcards(flashcards, azar),
    ];
    const verdaderoFalso = this.verdaderoFalsoDesde(flashcards, azar);

    // Se alternan los tipos para que la lección no sea cinco veces lo mismo.
    const fuentes = [barajar(opciones, azar), barajar(huecos, azar), barajar(verdaderoFalso, azar)];
    const elegidos: Ejercicio[] = [];
    const vistos = new Set<string>();
    let huecosElegidos = 0;

    for (let ronda = 0; elegidos.length < cantidad; ronda += 1) {
      let agregado = false;

      for (const fuente of fuentes) {
        const candidato = fuente[ronda];
        if (!candidato || elegidos.length >= cantidad) continue;
        if (candidato.tipo === 'hueco' && huecosElegidos >= MAXIMO_HUECOS) continue;

        const clave = candidato.enunciado.toLowerCase();
        if (vistos.has(clave)) continue;

        vistos.add(clave);
        elegidos.push(candidato);
        if (candidato.tipo === 'hueco') huecosElegidos += 1;
        agregado = true;
      }

      if (!agregado) break;
    }

    // Si aún faltan, se completa con huecos aunque pasen el tope: mejor lección que hueco vacío.
    if (elegidos.length < cantidad) {
      for (const candidato of fuentes[1]) {
        if (elegidos.length >= cantidad) break;
        const clave = candidato.enunciado.toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        elegidos.push(candidato);
      }
    }

    return elegidos;
  }

  private desdeQuiz(item: ItemQuiz): Ejercicio | null {
    if (!item.opciones?.length || item.correcta < 0 || item.correcta >= item.opciones.length) {
      return null;
    }

    const frase = FRASE_ENTRE_COMILLAS.exec(item.pregunta)?.[1];

    if (frase && frase.includes(HUECO)) {
      return {
        tipo: 'hueco',
        enunciado: frase,
        opciones: item.opciones,
        correcta: item.correcta,
        pagina: item.pagina ?? null,
        explicacion: frase.replace(HUECO, item.opciones[item.correcta]),
      };
    }

    return {
      tipo: 'opcion',
      enunciado: item.pregunta,
      opciones: item.opciones,
      correcta: item.correcta,
      pagina: item.pagina ?? null,
      explicacion: null,
    };
  }

  /** Cloze de flashcards: la respuesta correcta más términos de otras tarjetas como distractores. */
  private huecosDesdeFlashcards(flashcards: ItemFlashcard[], azar: () => number): Ejercicio[] {
    const cloze = flashcards.filter((f) => f.tipo === 'cloze' && FRASE_ENTRE_COMILLAS.test(f.pregunta));
    const terminos = [...new Set(this.terminosDe(flashcards))];

    return cloze
      .map((tarjeta): Ejercicio | null => {
        const frase = FRASE_ENTRE_COMILLAS.exec(tarjeta.pregunta)?.[1] ?? '';
        const distractores = barajar(
          terminos.filter((t) => t.toLowerCase() !== tarjeta.respuesta.toLowerCase()),
          azar,
        ).slice(0, OPCIONES_HUECO - 1);

        if (!frase.includes(HUECO) || distractores.length < OPCIONES_HUECO - 1) return null;

        const opciones = barajar([tarjeta.respuesta, ...distractores], azar);

        return {
          tipo: 'hueco' as const,
          enunciado: frase,
          opciones,
          correcta: opciones.indexOf(tarjeta.respuesta),
          pagina: tarjeta.pagina ?? null,
          explicacion: frase.replace(HUECO, tarjeta.respuesta),
        };
      })
      .filter(esEjercicio);
  }

  /**
   * Verdadero/falso: la oración del libro tal cual, o con el término cambiado
   * por otro del mismo capítulo. Se alternan para que no se adivine.
   */
  private verdaderoFalsoDesde(flashcards: ItemFlashcard[], azar: () => number): Ejercicio[] {
    const conTermino = flashcards
      .map((f) => ({ tarjeta: f, termino: TERMINO_DE_PREGUNTA.exec(f.pregunta)?.[1]?.trim() ?? '' }))
      .filter((f) => f.termino && f.tarjeta.tipo !== 'cloze');

    const terminos = conTermino.map((f) => f.termino);

    return conTermino
      .map(({ tarjeta, termino }, indice): Ejercicio | null => {
        const esVerdadera = indice % 2 === 0;
        const pagina = tarjeta.pagina ?? null;

        if (esVerdadera) {
          return {
            tipo: 'verdadero_falso' as const,
            enunciado: `Según el libro: «${tarjeta.respuesta}»`,
            opciones: ['Verdadero', 'Falso'],
            correcta: 0,
            pagina,
            explicacion: null,
          };
        }

        const otros = barajar(terminos.filter((t) => t.toLowerCase() !== termino.toLowerCase()), azar);
        const cambiada = otros.length > 0 ? reemplazarTermino(tarjeta.respuesta, termino, otros[0]) : null;
        if (!cambiada) return null;

        return {
          tipo: 'verdadero_falso' as const,
          enunciado: `Según el libro: «${cambiada}»`,
          opciones: ['Verdadero', 'Falso'],
          correcta: 1,
          pagina,
          explicacion: `En el libro dice: «${tarjeta.respuesta}»`,
        };
      })
      .filter(esEjercicio);
  }

  private terminosDe(flashcards: ItemFlashcard[]): string[] {
    return flashcards
      .map((f) => (f.tipo === 'cloze' ? f.respuesta : TERMINO_DE_PREGUNTA.exec(f.pregunta)?.[1]?.trim()))
      .filter((t): t is string => !!t);
  }
}

function esEjercicio(valor: Ejercicio | null): valor is Ejercicio {
  return valor !== null;
}
