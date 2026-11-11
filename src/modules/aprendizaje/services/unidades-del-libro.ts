import { createHash } from 'crypto';

import { Chapter } from '../../documents/entities/chapter.entity';
import { TramoCapitulos, agruparCapitulos } from '../../documents/services/capitulos.service';
import { titulosDeUnidad } from './titulos-de-unidad';

/** Páginas por unidad cuando el libro no trae capítulos: alcanza para una lección sin hacerla eterna. */
const PAGINAS_POR_UNIDAD = 12;

/** Una portada o un índice de una o dos hojas no da para lección y trancaría la ruta desde el inicio. */
const PAGINAS_DE_PRELIMINAR = 2;
// `\b` no reconoce las vocales con tilde: "Índice" no empezaría palabra.
const TITULO_PRELIMINAR = /(?<!\p{L})(portada|car[áa]tula|cover|[íi]ndice|contenido|cr[ée]ditos|contraportada)(?!\p{L})/iu;

function esPreliminar(capitulo: Chapter): boolean {
  const paginas = capitulo.paginaFin - capitulo.paginaInicio + 1;
  return paginas <= PAGINAS_DE_PRELIMINAR && TITULO_PRELIMINAR.test(capitulo.titulo);
}

/** Id estable con forma de UUID: la unidad por páginas no existe en `chapters`, pero lecciones e intentos la guardan igual. */
export function idDeUnidadPorPaginas(documentId: string, paginaInicio: number): string {
  const h = createHash('sha1').update(`${documentId}:paginas:${paginaInicio}`).digest('hex');
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Partes parejas del libro, para que un libro sin capítulos detectados también tenga ruta. */
export function unidadesPorPaginas(documentId: string, totalPaginas: number, maximo: number): TramoCapitulos[] {
  if (!(totalPaginas > 0) || maximo <= 0) return [];

  const partes = Math.min(maximo, Math.max(1, Math.ceil(totalPaginas / PAGINAS_POR_UNIDAD)));
  const porParte = Math.ceil(totalPaginas / partes);
  const unidades: TramoCapitulos[] = [];

  for (let inicio = 1; inicio <= totalPaginas; inicio += porParte) {
    const fin = Math.min(totalPaginas, inicio + porParte - 1);
    unidades.push({
      id: idDeUnidadPorPaginas(documentId, inicio),
      titulo: inicio === fin ? `Página ${inicio}` : `Páginas ${inicio}–${fin}`,
      paginaInicio: inicio,
      paginaFin: fin,
      capitulos: [],
    });
  }

  return unidades;
}

/** Las unidades de la ruta: los capítulos sin portadas ni índices o, si no hay, partes por páginas. */
export function unidadesDelLibro(
  documentId: string,
  capitulos: Chapter[],
  totalPaginas: number,
  maximo: number,
): TramoCapitulos[] {
  const estudiables = capitulos.filter((capitulo) => !esPreliminar(capitulo));
  // Si quitar los preliminares deja el libro sin unidades, se conservan todas.
  const elegidos = estudiables.length > 0 ? estudiables : capitulos;
  const titulos = titulosDeUnidad(elegidos.map((capitulo) => capitulo.titulo));
  const utiles = elegidos.map((capitulo, i) => ({ ...capitulo, titulo: titulos[i] }));

  return utiles.length > 0
    ? agruparCapitulos(utiles, maximo)
    : unidadesPorPaginas(documentId, totalPaginas, maximo);
}
