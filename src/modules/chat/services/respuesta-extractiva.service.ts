import { Injectable } from '@nestjs/common';

import { AnclajeService, PasajeRecuperado } from '../../anclaje/anclaje.service';

/** Debajo el pasaje habla de otra cosa (calibrado en test/mediciones); lo que tiene todas las palabras vale igual. */
export const MINIMO_PARECIDO = 0.82;

const PASAJES_CANDIDATOS = 8;
const PASAJES_EN_RESPUESTA = 3;
const ORACIONES_POR_PASAJE = 2;
const LARGO_MAXIMO_ORACION = 320;

type Idioma = 'es' | 'en';

const TEXTOS = {
  es: {
    intro: 'Esto es lo que dice el libro sobre tu pregunta:',
    introBiblioteca: 'Esto es lo que encontré en tus libros:',
    tutor: 'Lee este pasaje y explícame con tus palabras cuál es su idea principal:',
    nada: 'No encontré en este libro un pasaje que responda eso. Prueba con otras palabras, o con el nombre de un tema o capítulo.',
    nadaBiblioteca: 'No encontré nada sobre eso en tus libros. Prueba con otras palabras, o sube el libro donde crees que está.',
    pie: '_Respuesta armada con pasajes del libro por el motor propio, sin IA externa._',
    sinDiagrama: '_Los diagramas necesitan la ayuda de Gemini; actívala arriba para pedirlos._',
  },
  en: {
    intro: 'This is what the book says about your question:',
    introBiblioteca: 'This is what I found in your books:',
    tutor: 'Read this passage and explain its main idea in your own words:',
    nada: 'I could not find a passage in this book that answers that. Try different words, or the name of a topic or chapter.',
    nadaBiblioteca: 'I could not find anything about that in your books. Try different words or upload the book where you think it appears.',
    pie: '_Answer built from passages of the book by our own engine, without external AI._',
    sinDiagrama: '_Diagrams need Gemini assistance; turn it on above to request them._',
  },
} as const;

// En los dos idiomas: es el formato que el lector convierte en un chip que abre la página.
const PAGINA = 'pág.';

/** Palabras con contenido, sin acentos ni mayúsculas: lo que se compara entre pregunta y oración. */
export function palabrasClave(texto: string): Set<string> {
  const normalizado = texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return new Set((normalizado.match(/[\p{L}\p{N}]+/gu) ?? []).filter((palabra) => palabra.length >= 4));
}

/** Las oraciones del pasaje que más palabras comparten con la pregunta, en su orden original. */
export function oracionesClave(texto: string, pregunta: string, cuantas = ORACIONES_POR_PASAJE): string[] {
  const oraciones = texto
    .split(/(?<=[.!?…])\s+/)
    .map((oracion) => oracion.replace(/\s+/g, ' ').trim())
    .filter((oracion) => oracion.split(' ').length >= 5);
  if (oraciones.length === 0) return [];

  const claves = palabrasClave(pregunta);
  const puntuadas = oraciones.map((oracion, indice) => {
    const propias = palabrasClave(oracion);
    return { oracion, indice, puntos: [...claves].filter((clave) => propias.has(clave)).length };
  });

  // Sin palabras en común (la búsqueda acertó por significado), el inicio del pasaje es lo más seguro.
  const elegidas = puntuadas.some((p) => p.puntos > 0)
    ? [...puntuadas].sort((a, b) => b.puntos - a.puntos || a.indice - b.indice).slice(0, cuantas)
    : puntuadas.slice(0, cuantas);

  return elegidas
    .sort((a, b) => a.indice - b.indice)
    .map(({ oracion }) =>
      oracion.length > LARGO_MAXIMO_ORACION
        ? `${oracion.slice(0, LARGO_MAXIMO_ORACION).replace(/\s+\S*$/, '')}…`
        : oracion,
    );
}

/** Pasajes que sí hablan de la pregunta. */
export function pasajesUtiles<T extends Pick<PasajeRecuperado, 'score' | 'lexico'>>(pasajes: T[]): T[] {
  return pasajes.filter((pasaje) => pasaje.lexico || pasaje.score >= MINIMO_PARECIDO);
}

/** Responde citando pasajes del libro, sin redactar: es el chat cuando la ayuda de Gemini está apagada. */
@Injectable()
export class RespuestaExtractivaService {
  constructor(private readonly anclaje: AnclajeService) {}

  async responder(
    documentId: string,
    pregunta: string,
    opciones: { idioma?: Idioma; tutor?: boolean; pidioDiagrama?: boolean } = {},
  ): Promise<string> {
    const textos = TEXTOS[opciones.idioma ?? 'es'];
    const utiles = pasajesUtiles(await this.anclaje.recuperar(documentId, pregunta, PASAJES_CANDIDATOS));
    if (utiles.length === 0) return textos.nada;

    if (opciones.tutor) {
      const [pasaje] = utiles;
      const cita = oracionesClave(pasaje.texto, pregunta, 3).join(' ');
      return `${textos.tutor}\n\n«${cita}» (${PAGINA} ${pasaje.pagina})`;
    }

    const vinetas = utiles
      .slice(0, PASAJES_EN_RESPUESTA)
      .map((pasaje) => ({ pagina: pasaje.pagina, cita: oracionesClave(pasaje.texto, pregunta).join(' ') }))
      .filter(({ cita }) => cita)
      .map(({ pagina, cita }) => `- «${cita}» (${PAGINA} ${pagina})`);
    if (vinetas.length === 0) return textos.nada;

    return [textos.intro, vinetas.join('\n'), ...(opciones.pidioDiagrama ? [textos.sinDiagrama] : []), textos.pie].join(
      '\n\n',
    );
  }

  /** Lo mismo para el asistente de biblioteca: cada cita dice de qué libro sale. */
  enBiblioteca(
    pregunta: string,
    pasajes: { titulo: string; pagina: number; texto: string }[],
    idioma: Idioma = 'es',
  ): string {
    const textos = TEXTOS[idioma];
    const vinetas = pasajes
      .slice(0, PASAJES_EN_RESPUESTA)
      .map((pasaje) => ({ ...pasaje, cita: oracionesClave(pasaje.texto, pregunta).join(' ') }))
      .filter(({ cita }) => cita)
      .map(({ titulo, pagina, cita }) => `- «${cita}» — *${titulo}*, ${PAGINA} ${pagina}`);
    if (vinetas.length === 0) return textos.nadaBiblioteca;

    return [textos.introBiblioteca, vinetas.join('\n'), textos.pie].join('\n\n');
  }
}
