/** Título y autor tal como los declara el propio archivo (PDF Info/XMP u OPF del EPUB). */
export interface MetadatosLibro {
  titulo: string | null;
  autor: string | null;
}

export const LARGO_MAXIMO_TITULO = 200;
export const LARGO_MAXIMO_AUTOR = 120;

// Lo agregan la descarga repetida, el explorador o el compresor de PDF; nunca es parte del libro.
const SUFIJO_DE_ARCHIVO =
  /(?:\s*\(\d+\)|\s*\[\d+\]|\s+-\s+(?:copia|copy)|[\s._-]+(?:ilovepdf|compressed|comprimido|optimizado|optimized))$/i;

// Valores que ponen los programas de oficina cuando nadie escribió un título.
const TITULO_DE_RELLENO =
  /^(?:untitled|sin t[ií]tulo|t[ií]tulo|title|documento?\s*\d*|presentaci[oó]n\s*\d*|microsoft (?:word|powerpoint)\b.*|libro\d*|portada)$/i;

const AUTOR_DE_RELLENO =
  /^(?:unknown|desconocido|an[oó]nimo|usuario|user|admin(?:istrador)?|owner|author|autor|pc|windows user|microsoft office user)$/i;

const EXTENSION_DE_ARCHIVO = /\.(?:pdf|epub|docx?|pptx?|odt|indd|tex|txt)\b/i;

const espacios = (texto: string) => texto.replace(/\s+/g, ' ').trim();

/** "el principito (1)" → "El principito"; respeta siglas y no agrega tildes que falten. */
export function tituloDesdeArchivo(nombreSinExtension: string): string {
  let titulo = espacios(nombreSinExtension.replace(/_+/g, ' '));

  // Puede haber varios: "medio social compressed (1)".
  for (let anterior = ''; anterior !== titulo; ) {
    anterior = titulo;
    titulo = espacios(titulo.replace(SUFIJO_DE_ARCHIVO, ''));
  }

  titulo = espacios(titulo.replace(/-+/g, ' '));

  // Solo si la primera palabra va toda en minúsculas: "iPad" o "DBS" se quedan como están.
  const [primera] = titulo.split(' ');
  if (primera && /^\p{Ll}+$/u.test(primera)) {
    titulo = primera.charAt(0).toLocaleUpperCase('es') + titulo.slice(1);
  }

  return titulo.slice(0, LARGO_MAXIMO_TITULO) || 'Documento sin título';
}

/** El título que trae el archivo, o null si es un valor de relleno del programa que lo creó. */
export function tituloDeMetadatos(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const titulo = espacios(valor);

  if (titulo.length < 2 || !/\p{L}/u.test(titulo)) return null;
  if (TITULO_DE_RELLENO.test(titulo) || EXTENSION_DE_ARCHIVO.test(titulo)) return null;

  return titulo.slice(0, LARGO_MAXIMO_TITULO);
}

export function autorDeMetadatos(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const autor = espacios(valor);

  if (autor.length < 2 || !/\p{L}/u.test(autor) || AUTOR_DE_RELLENO.test(autor)) return null;

  return autor.slice(0, LARGO_MAXIMO_AUTOR);
}
