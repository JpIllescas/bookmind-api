import { Injectable } from '@nestjs/common';

import { AnclajeService, PasajeRecuperado } from '../../anclaje/anclaje.service';

/** Debajo el pasaje habla de otra cosa (calibrado en test/mediciones); lo que tiene todas las palabras vale igual. */
export const MINIMO_PARECIDO = 0.82;

const PASAJES_CANDIDATOS = 8;
const PASAJES_EN_RESPUESTA = 3;
const ORACIONES_POR_PASAJE = 2;
const LARGO_MAXIMO_ORACION = 320;
/** La cita sigue con la oración de al lado mientras quede corta: en un diálogo la respuesta va después de la pregunta. */
const PALABRAS_POR_CITA = 28;
/** Una línea de diálogo como "—¡Píntame un cordero!" ya dice algo; menos que esto no. */
const MINIMO_PALABRAS_ORACION = 3;
/** Debajo de esta proporción de piezas reconocibles (palabras o cifras), la oración es ruido de OCR. */
const MINIMO_LEGIBLE = 0.85;
/** Y al menos esta proporción tienen que ser palabras. */
const MINIMO_PALABRAS_LEGIBLE = 0.5;
/** La segunda oración de un pasaje entra solo si responde casi tanto como la primera. */
const MINIMO_SEGUNDA = 0.4;
/** Letras con las que se compara una palabra: "dibuje" y "dibújame" comparten raíz. */
const LARGO_RAIZ = 5;
/** Cuánto sube una oración en la que el libro se hace la misma pregunta: la respuesta viene justo después. */
const PESO_MISMA_PREGUNTA = 2.5;

/** Palabras de la pregunta que no dicen de qué trata (ya sin acentos). */
const PALABRAS_DE_PREGUNTA = new Set([
  'cual', 'cuales', 'cuando', 'donde', 'como', 'quien', 'quienes', 'cuanto', 'cuantos', 'cuantas', 'para', 'porque',
  'segun', 'sobre', 'entre', 'desde', 'hasta', 'este', 'esta', 'esto', 'estos', 'estas', 'esos', 'esas', 'tiene',
  'tienen', 'hace', 'hacen', 'hacer', 'libro', 'pagina', 'dice', 'dicen', 'explica', 'explicame', 'cuentame', 'todo',
  'todos', 'toda', 'todas', 'cada', 'otro', 'otra', 'tambien', 'pero', 'algo', 'that', 'what', 'which', 'when',
  'where', 'does', 'about', 'with', 'from', 'this', 'book',
]);

/** Marca, dentro de una cita, que entre dos oraciones del pasaje hay texto que no se copió. */
const SALTO = '[…]';

/** Lo que vale una oración que el fragmento cortó: puede ser la respuesta, pero se prefiere una entera. */
const PESO_CORTADA = 0.5;

/** Una oración del pasaje, marcada si el fragmento la cortó al empezar o al terminar. */
interface Oracion {
  texto: string;
  cortadaAlInicio: boolean;
  cortadaAlFinal: boolean;
}

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

const sinAcentos = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const raizDe = (palabra: string) => palabra.slice(0, LARGO_RAIZ);

/** Raíces de las palabras con contenido de un texto, en orden. */
function raices(texto: string): string[] {
  return (sinAcentos(texto).match(/[\p{L}\p{N}]+/gu) ?? []).filter((palabra) => palabra.length >= 4).map(raizDe);
}

/** Las palabras de la pregunta que dicen de qué trata, sin acentos ni repetir. */
export function palabrasDeLaPregunta(pregunta: string): string[] {
  return [
    ...new Set(
      (sinAcentos(pregunta).match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (palabra) => palabra.length >= 4 && !PALABRAS_DE_PREGUNTA.has(palabra),
      ),
    ),
  ];
}

/** Lo que se busca de la pregunta: las raíces de esas palabras. */
export function palabrasClave(texto: string): Set<string> {
  return new Set(palabrasDeLaPregunta(texto).map(raizDe));
}

/** Peso de cada raíz según en cuántos fragmentos del libro aparece su palabra; la que no está en el libro no suma. */
export function pesosDelLibro(
  palabras: string[],
  frecuencias: { fragmentos: number; porPalabra: number[] },
): Map<string, number> {
  const pesos = new Map<string, number>();
  palabras.forEach((palabra, i) => {
    const enFragmentos = frecuencias.porPalabra[i] ?? 0;
    const peso = enFragmentos === 0 ? 0 : Math.log(1 + frecuencias.fragmentos / enFragmentos);
    pesos.set(raizDe(palabra), Math.max(pesos.get(raizDe(palabra)) ?? 0, peso));
  });
  return pesos;
}

const INTERROGATIVO = /(?:^|[^\p{L}])(por que|que|quienes|quien|como|donde|cuando|cuantos|cuantas|cuanto|cuales|cual)(?![\p{L}])/u;

/** "¿Por qué bebe el bebedor?" frente a "—¿Por qué bebes?": el libro se hace la misma pregunta y responde después. */
function mismaPregunta(oracion: string, pregunta: string): boolean {
  if (!oracion.includes('¿')) return false;
  const buscado = INTERROGATIVO.exec(sinAcentos(pregunta))?.[1];
  return buscado !== undefined && INTERROGATIVO.exec(sinAcentos(oracion.slice(oracion.indexOf('¿'))))?.[1] === buscado;
}

// "bebe" y "bebedor", o "dibuj" y "dibujo": una raíz corta vale si es el comienzo de la otra.
const coincide = (clave: string, raiz: string) => raiz.startsWith(clave) || clave.startsWith(raiz);

/**
 * Parte por oración solo si sigue una mayúscula o un guion de diálogo que abre otra intervención:
 * "Por favor... píntame" es una sola, y "—¿Por qué bebes? —volvió a preguntar" también.
 */
export function partirEnOraciones(texto: string): Oracion[] {
  const trozos = texto
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…»"”])\s+(?=[—–-]\s?[¿¡«"“\p{Lu}]|[¿¡«"“(\p{Lu}\p{N}])/u)
    .map((trozo) => quitarRuidoInicial(trozo.trim()))
    .filter(Boolean);

  // El fragmento empieza y termina donde cayó el corte, no donde empieza la oración.
  return trozos.map((trozo, indice) => ({
    texto: trozo,
    cortadaAlInicio: indice === 0 && /^[\p{Ll},;:]/u.test(trozo),
    cortadaAlFinal: indice === trozos.length - 1 && !/[.!?…»"”)]$/.test(trozo),
  }));
}

/** El OCR de una página mala deja "$'.l""lmulml” LUSAR f": una oración así no se le muestra a nadie. */
export function esLegible(oracion: string): boolean {
  const piezas = oracion
    .split(/\s+/)
    .map((pieza) => pieza.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  if (piezas.length === 0) return false;

  const palabras = piezas.filter(
    (pieza) =>
      /^\p{L}+(?:[-'’]\p{L}+)*$/u.test(pieza) &&
      // Solo "a", "e", "o", "u" e "y" son palabras de una letra; las demás, sin vocal, son ruido.
      (pieza.length === 1 ? /^[aeouy]$/i.test(pieza) : /[aeiouáéíóúüy]/i.test(pieza)),
  ).length;
  const numeros = piezas.filter((pieza) => /^\p{N}+(?:[.,]\p{N}+)*%?$/u.test(pieza)).length;
  // Los números cuentan como legibles, pero una fila de cifras de un ejercicio no es una oración.
  return (palabras + numeros) / piezas.length >= MINIMO_LEGIBLE && palabras / piezas.length >= MINIMO_PALABRAS_LEGIBLE;
}

/** "1 2 2 3 + 6) Recuerdo que…": las cifras sueltas de un ejercicio; un año o un guion de diálogo solos se quedan. */
const quitarRuidoInicial = (oracion: string) =>
  oracion.replace(/^[^\p{L}\s—–-][^\p{L}\s]*\s+(?:[^\p{L}\s]+\s+)+(?=\p{L})/u, '');

/** Cuánto informa cada raíz de la pregunta: la que está en todas las oraciones ("principito") casi no cuenta. */
function pesosDe(claves: Set<string>, oraciones: string[]): Map<string, number> {
  const raicesPorOracion = oraciones.map((oracion) => raices(oracion));
  return new Map(
    [...claves].map((clave) => {
      const conLaClave = raicesPorOracion.filter((propias) => propias.some((raiz) => coincide(clave, raiz))).length;
      return [clave, Math.log(1 + oraciones.length / (1 + conLaClave))];
    }),
  );
}

/** Cada palabra de la oración cuenta para una sola clave: "bebedor" no vale por "bebe" y por "bebedor" a la vez. */
function puntosDe(oracion: string, pesos: Map<string, number>): number {
  const libres = raices(oracion);
  let puntos = 0;
  for (const [clave, peso] of [...pesos].sort((a, b) => b[1] - a[1])) {
    const indice = libres.findIndex((raiz) => coincide(clave, raiz));
    if (indice < 0) continue;
    puntos += peso;
    libres.splice(indice, 1);
  }
  return puntos;
}

/** Una oración larguísima se recorta alrededor de la primera palabra que responde, sin cortar palabras. */
function recortar(oracion: string, pesos: Map<string, number>): string {
  if (oracion.length <= LARGO_MAXIMO_ORACION) return oracion;

  const normal = sinAcentos(oracion);
  const posiciones = [...pesos.keys()]
    .map((clave) => normal.search(new RegExp(`(?<![\\p{L}\\p{N}])${clave}`, 'u')))
    .filter((posicion) => posicion >= 0);
  const centro = posiciones.length > 0 ? Math.min(...posiciones) : 0;
  const inicio = Math.max(0, Math.min(centro - LARGO_MAXIMO_ORACION / 3, oracion.length - LARGO_MAXIMO_ORACION));

  let trozo = oracion.slice(inicio, inicio + LARGO_MAXIMO_ORACION);
  if (inicio > 0) trozo = `…${trozo.replace(/^\S*\s+/, '')}`;
  if (inicio + LARGO_MAXIMO_ORACION < oracion.length) trozo = `${trozo.replace(/\s+\S*$/, '')}…`;
  return trozo;
}

// Lo que el fragmento cortó se marca con "…": el estudiante sabe que la cita sigue en el libro.
const comoSeLee = (oracion: Oracion) =>
  `${oracion.cortadaAlInicio ? '…' : ''}${oracion.texto}${oracion.cortadaAlFinal ? '…' : ''}`;

/** La mejor oración del pasaje y las que la siguen, contiguas: una cita, no frases sueltas pegadas. */
function citaDe(
  texto: string,
  pregunta: string,
  pesos: Map<string, number>,
  cuantas: number,
): { oraciones: string[]; puntos: number } | null {
  const oraciones = partirEnOraciones(texto);
  const candidatas = oraciones
    .map((oracion, indice) => ({ oracion, indice }))
    .filter(
      ({ oracion }) =>
        esLegible(oracion.texto) &&
        oracion.texto.split(' ').length >= MINIMO_PALABRAS_ORACION &&
        // "—preguntó el principito." es la acotación de lo anterior, no algo que citar solo.
        !/^[—–-]\s?\p{Ll}/u.test(oracion.texto),
    );
  if (candidatas.length === 0) return null;

  const puntuadas = candidatas.map((c) => {
    const cortada = c.oracion.cortadaAlInicio || c.oracion.cortadaAlFinal;
    const puntos = puntosDe(c.oracion.texto, pesos);
    const factor = (cortada ? PESO_CORTADA : 1) * (puntos > 0 && mismaPregunta(c.oracion.texto, pregunta) ? PESO_MISMA_PREGUNTA : 1);
    return { ...c, cortada, puntos: puntos * factor };
  });
  // Sin palabras en común (la búsqueda acertó por significado), el inicio del pasaje es lo más seguro.
  const enteras = puntuadas.filter((p) => !p.cortada);
  const mejor = puntuadas.reduce(
    (a, b) => (b.puntos > a.puntos ? b : a),
    enteras[0] ?? puntuadas[0],
  );

  const elegidas = [mejor.oracion];
  let palabras = mejor.oracion.texto.split(' ').length;
  let ultima = mejor.indice;
  for (let i = mejor.indice + 1; i < oraciones.length && elegidas.length < cuantas; i++) {
    if (palabras >= PALABRAS_POR_CITA || !esLegible(oraciones[i].texto)) break;
    elegidas.push(oraciones[i]);
    palabras += oraciones[i].texto.split(' ').length;
    ultima = i;
  }
  const cita = elegidas.map((o) => recortar(comoSeLee(o), pesos));

  // Si otra oración del pasaje también responde, va aparte y con "[…]": se ve que hay un salto.
  const yaCitadas = new Set(elegidas.map((o) => sinAcentos(o.texto)));
  const otra = puntuadas
    .filter(
      (p) =>
        p.puntos > 0 &&
        p.puntos >= MINIMO_SEGUNDA * mejor.puntos &&
        (p.indice < mejor.indice || p.indice > ultima) &&
        !yaCitadas.has(sinAcentos(p.oracion.texto)),
    )
    .reduce<(typeof puntuadas)[number] | null>((a, b) => (a === null || b.puntos > a.puntos ? b : a), null);
  if (otra) {
    const aparte = recortar(comoSeLee(otra.oracion), pesos);
    return {
      oraciones: otra.indice < mejor.indice ? [aparte, SALTO, ...cita] : [...cita, SALTO, aparte],
      puntos: mejor.puntos,
    };
  }

  return { oraciones: cita, puntos: mejor.puntos };
}

/** La cita del pasaje que mejor responde la pregunta, con las oraciones que la siguen. */
export function oracionesClave(texto: string, pregunta: string, cuantas = ORACIONES_POR_PASAJE): string[] {
  const pesos = pesosDe(palabrasClave(pregunta), partirEnOraciones(texto).map((o) => o.texto));
  return citaDe(texto, pregunta, pesos, cuantas)?.oraciones ?? [];
}

/**
 * Una cita por pasaje, en el orden de la búsqueda, sin repetir la misma (los fragmentos se solapan).
 * Primero los pasajes que comparten palabras con la pregunta; los que solo se parecen en significado, después.
 * Sin pesos del libro, se calculan sobre los mismos pasajes.
 */
export function mejoresCitas<T extends { texto: string }>(
  pasajes: T[],
  pregunta: string,
  cuantos = PASAJES_EN_RESPUESTA,
  oracionesPorCita = ORACIONES_POR_PASAJE,
  pesos = pesosDe(palabrasClave(pregunta), pasajes.flatMap((p) => partirEnOraciones(p.texto).map((o) => o.texto))),
): (T & { cita: string })[] {
  const citados = pasajes
    .map((pasaje) => ({ pasaje, cita: citaDe(pasaje.texto, pregunta, pesos, oracionesPorCita) }))
    .filter((c): c is typeof c & { cita: NonNullable<typeof c.cita> } => c.cita !== null);
  const enOrden = [...citados.filter((c) => c.cita.puntos > 0), ...citados.filter((c) => c.cita.puntos === 0)];

  // Sin los "…" que marcan el corte, dos fragmentos solapados dan la misma cita.
  const comparable = (texto: string) => sinAcentos(texto).replace(/…/g, '').trim();
  const vistas: string[] = [];
  const elegidos: (T & { cita: string })[] = [];
  for (const { pasaje, cita } of enOrden) {
    const texto = cita.oraciones.join(' ');
    const clave = comparable(texto);
    if (vistas.some((vista) => vista.includes(clave) || clave.includes(vista))) continue;
    vistas.push(clave);
    elegidos.push({ ...pasaje, cita: texto });
    if (elegidos.length === cuantos) break;
  }
  return elegidos;
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
    opciones: {
      idioma?: Idioma;
      tutor?: boolean;
      pidioDiagrama?: boolean;
      detalle?: 'brief' | 'normal' | 'deep';
    } = {},
  ): Promise<string> {
    const textos = TEXTOS[opciones.idioma ?? 'es'];
    const utiles = pasajesUtiles(await this.anclaje.recuperar(documentId, pregunta, PASAJES_CANDIDATOS));
    if (utiles.length === 0) return textos.nada;

    const palabras = palabrasDeLaPregunta(pregunta);
    const pesos = pesosDelLibro(palabras, await this.anclaje.frecuencias(documentId, palabras));

    if (opciones.tutor) {
      const [pasaje] = mejoresCitas(utiles, pregunta, 1, 3, pesos);
      if (!pasaje) return textos.nada;
      return `${textos.tutor}\n\n«${pasaje.cita}» (${PAGINA} ${pasaje.pagina})`;
    }

    const cantidadPasajes = opciones.detalle === 'brief'
      ? 1
      : opciones.detalle === 'deep'
        ? 5
        : PASAJES_EN_RESPUESTA;
    const oracionesPorPasaje = opciones.detalle === 'brief'
      ? 1
      : opciones.detalle === 'deep'
        ? 3
        : ORACIONES_POR_PASAJE;
    const vinetas = mejoresCitas(utiles, pregunta, cantidadPasajes, oracionesPorPasaje, pesos).map(
      ({ pagina, cita }) => `- «${cita}» (${PAGINA} ${pagina})`,
    );
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
    const vinetas = mejoresCitas(pasajes, pregunta).map(
      ({ titulo, pagina, cita }) => `- «${cita}» — *${titulo}*, ${PAGINA} ${pagina}`,
    );
    if (vinetas.length === 0) return textos.nadaBiblioteca;

    return [textos.introBiblioteca, vinetas.join('\n'), textos.pie].join('\n\n');
  }
}
