import { Materia } from '../enums/materia.enum';
import { Nivel } from '../enums/nivel.enum';

/** Nombres para mostrar en la interfaz. */
export const MATERIA_LEGIBLE: Record<Materia, string> = {
  [Materia.Matematicas]: 'Matemáticas',
  [Materia.CienciasNaturales]: 'Ciencias Naturales',
  [Materia.CienciasSociales]: 'Ciencias Sociales',
  [Materia.ComunicacionLenguaje]: 'Comunicación y Lenguaje',
  [Materia.Ingles]: 'Inglés',
  [Materia.Otro]: 'General',
};

export const NIVEL_LEGIBLE: Record<Nivel, string> = {
  [Nivel.PrimariaBaja]: 'Primaria baja',
  [Nivel.PrimariaAlta]: 'Primaria alta',
  [Nivel.Basicos]: 'Ciclo básico',
};

/** Registro del system prompt según el nivel detectado. */
export const INSTRUCCION_POR_NIVEL: Record<Nivel, string> = {
  [Nivel.PrimariaBaja]:
    'Usa palabras muy sencillas y frases cortas. Da ejemplos concretos y ' +
    'cotidianos. Mantén un tono alentador y cercano.',
  [Nivel.PrimariaAlta]:
    'Usa un lenguaje claro. Puedes introducir algún término nuevo, pero ' +
    'explícalo siempre con palabras sencillas.',
  [Nivel.Basicos]:
    'Puedes profundizar y usar vocabulario técnico, definiéndolo la primera ' +
    'vez que aparezca.',
};

/** Chips de acción rápida del chat, según la materia. */
export const ACCIONES_POR_MATERIA: Record<Materia, string[]> = {
  [Materia.Matematicas]: [
    'Explica este problema paso a paso',
    'Crea ejercicios',
    'Generar examen',
  ],
  [Materia.CienciasNaturales]: [
    'Resúmeme el tema',
    'Hazme flashcards',
    'Explícalo con un ejemplo',
  ],
  [Materia.CienciasSociales]: [
    'Línea de tiempo',
    'Resumen del capítulo',
    'Generar examen',
  ],
  [Materia.ComunicacionLenguaje]: [
    'Explica esta palabra',
    'Resumen de la lectura',
    'Preguntas de comprensión',
  ],
  [Materia.Ingles]: [
    'Traduce y explica',
    'Vocabulario clave',
    'Practica con preguntas',
  ],
  [Materia.Otro]: ['Resúmeme el tema', 'Hazme flashcards', 'Generar examen'],
};

/** Colores de portada por materia. */
export const TINTE_POR_MATERIA: Record<Materia, string> = {
  [Materia.Matematicas]: '#B4552E',
  [Materia.CienciasNaturales]: '#3F5E57',
  [Materia.ComunicacionLenguaje]: '#5A4B7A',
  [Materia.CienciasSociales]: '#8A6D3B',
  [Materia.Ingles]: '#4A6070',
  [Materia.Otro]: '#B4552E',
};

/** Etiqueta de biblioteca: "Ciencias Naturales · Primaria alta". */
export function etiquetaLegible(
  materia: Materia | null,
  nivel: Nivel | null,
): string {
  if (!materia && !nivel) return 'Sin clasificar';

  return [
    materia ? MATERIA_LEGIBLE[materia] : null,
    nivel ? NIVEL_LEGIBLE[nivel] : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
