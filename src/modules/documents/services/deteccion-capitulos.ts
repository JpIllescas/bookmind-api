import { PaginaExtraida } from './extraccion.service';

/** Capítulo detectado en el texto, antes de guardarse. */
export interface CapituloDetectado {
  orden: number;
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
}

interface Marca {
  numero: number;
  titulo: string;
  pagina: number;
}

const ETIQUETAS: Record<string, string> = {
  capitulo: 'Capítulo',
  capítulo: 'Capítulo',
  unidad: 'Unidad',
  leccion: 'Lección',
  lección: 'Lección',
  tema: 'Tema',
  bloque: 'Bloque',
  seccion: 'Sección',
  sección: 'Sección',
  parte: 'Parte',
};

const NUMEROS_EN_PALABRAS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
};

/** "Capítulo 3", "UNIDAD II", "Tema cuatro": el mismo patrón que usa el clasificador. */
const ETIQUETA_NUMERADA =
  /\b(cap[íi]tulo|unidad|lecci[óo]n|tema|bloque|secci[óo]n|parte)\s+(\d{1,3}|[ivxlcdm]{1,7}|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince)\b(?:\s*[:.\-–—]?\s*)([^\n.]{0,70})?/gi;

/** Novelas y textos clásicos: un romano suelto seguido de una oración con mayúscula, o solo al pie de la página. */
const ROMANO_SUELTO =
  /(?:^|\s)([IVXLC]{1,8})(?:\s+(?=[A-ZÁÉÍÓÚÑ¿¡«"—-])([^\n.]{0,70})|\s*$)/g;

/** Con menos que esto no hay estructura que mostrar. */
const MINIMO_CAPITULOS = 2;

/** Cuántos números se pueden saltar sin romper la secuencia (un encabezado ilegible). */
const SALTO_TOLERADO = 1;

const LARGO_SUBTITULO = 48;

/** Encuentra los capítulos de un libro por sus encabezados, validando que la numeración avance. */
export function detectarCapitulos(paginas: PaginaExtraida[]): CapituloDetectado[] {
  const ordenadas = [...paginas].sort((a, b) => a.pagina - b.pagina);
  const ultimaPagina = ordenadas[ordenadas.length - 1]?.pagina ?? 0;

  // Se prueban las dos familias y gana la que arma la secuencia más larga.
  const candidatas = [marcasEtiquetadas(ordenadas), marcasRomanas(ordenadas)]
    .map(enSecuencia)
    .sort((a, b) => b.length - a.length);

  const marcas = candidatas[0] ?? [];
  if (marcas.length < MINIMO_CAPITULOS) return [];

  return capitulosDesdeMarcas(marcas, ultimaPagina);
}

/** Convierte títulos con página (de un índice o de la heurística) en capítulos con rango. */
export function capitulosDesdeMarcas(
  marcas: { titulo: string; pagina: number }[],
  ultimaPagina: number,
): CapituloDetectado[] {
  const ordenadas = [...marcas]
    .filter((marca) => marca.titulo.trim() && marca.pagina >= 1)
    .sort((a, b) => a.pagina - b.pagina);

  if (ordenadas.length < MINIMO_CAPITULOS) return [];

  return ordenadas.map((marca, i) => ({
    orden: i + 1,
    titulo: marca.titulo.trim().slice(0, 200),
    paginaInicio: marca.pagina,
    // Dos capítulos en la misma página comparten inicio y fin.
    paginaFin: Math.max(marca.pagina, (ordenadas[i + 1]?.pagina ?? ultimaPagina + 1) - 1),
  }));
}

function marcasEtiquetadas(paginas: PaginaExtraida[]): Marca[] {
  const marcas: Marca[] = [];

  for (const { pagina, texto } of paginas) {
    for (const coincidencia of texto.matchAll(ETIQUETA_NUMERADA)) {
      const etiqueta = ETIQUETAS[coincidencia[1].toLowerCase()] ?? 'Capítulo';
      const numero = comoNumero(coincidencia[2]);
      if (numero === null) continue;

      marcas.push({
        numero,
        pagina,
        titulo: conSubtitulo(`${etiqueta} ${numero}`, coincidencia[3]),
      });
    }
  }

  return marcas;
}

function marcasRomanas(paginas: PaginaExtraida[]): Marca[] {
  const marcas: Marca[] = [];

  paginas.forEach(({ pagina, texto }, i) => {
    for (const coincidencia of texto.matchAll(ROMANO_SUELTO)) {
      const numero = desdeRomano(coincidencia[1]);
      if (numero === null) continue;

      // Un romano solo al pie de la página abre el capítulo de la página siguiente.
      const alPie = coincidencia[2] === undefined && i < paginas.length - 1;

      marcas.push({
        numero,
        pagina: alPie ? paginas[i + 1].pagina : pagina,
        titulo: conSubtitulo(`Capítulo ${coincidencia[1]}`, coincidencia[2]),
      });
    }
  });

  return marcas;
}

/** Se queda con las marcas que continúan la numeración; "V" de una inicial no cuenta. */
function enSecuencia(marcas: Marca[]): Marca[] {
  const aceptadas: Marca[] = [];
  let esperado = 1;

  for (const marca of marcas) {
    if (marca.numero < esperado || marca.numero > esperado + SALTO_TOLERADO) continue;

    aceptadas.push(marca);
    esperado = marca.numero + 1;
  }

  return aceptadas;
}

function conSubtitulo(titulo: string, resto: string | undefined): string {
  // Un "Página 120" pegado al encabezado es folio, no subtítulo.
  const subtitulo = (resto ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*p[áa]g(ina)?\.?\s*\d+\s*[-–—:]?\s*/i, '')
    .trim();

  if (!subtitulo || /^\d+$/.test(subtitulo)) return titulo;

  const recortado =
    subtitulo.length > LARGO_SUBTITULO
      ? `${subtitulo.slice(0, LARGO_SUBTITULO).replace(/\s+\S*$/, '')}…`
      : subtitulo;

  return `${titulo} · ${recortado}`;
}

function comoNumero(valor: string): number | null {
  const texto = valor.toLowerCase();
  if (/^\d+$/.test(texto)) return Number(texto);
  if (texto in NUMEROS_EN_PALABRAS) return NUMEROS_EN_PALABRAS[texto];
  return desdeRomano(texto.toUpperCase());
}

const VALOR_ROMANO: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function desdeRomano(romano: string): number | null {
  if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(romano)) return null;

  let total = 0;
  for (let i = 0; i < romano.length; i += 1) {
    const actual = VALOR_ROMANO[romano[i]];
    const siguiente = VALOR_ROMANO[romano[i + 1]] ?? 0;
    total += actual < siguiente ? -actual : actual;
  }

  return total > 0 ? total : null;
}
