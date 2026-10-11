import type { OrigenPagina } from '../entities/document.entity';
import type { PaginaExtraida } from './extraccion.service';

/** Lo que devuelve el OCR de una página. */
export interface PaginaLeida {
  numero: number;
  texto: string;
  confianza: number;
}

export interface ResultadoFusion {
  paginas: PaginaExtraida[];
  origen: OrigenPagina[];
  paginasOcr: number;
  /** Media de las páginas que sí se tomaron del OCR; null si no se tomó ninguna. */
  confianzaMedia: number | null;
}

/** Páginas cuyo texto nativo es tan corto que probablemente son imagen: por página, para soportar PDF mixtos. */
export function paginasParaOcr(paginas: PaginaExtraida[], minimoCaracteres: number): number[] {
  return paginas
    .filter((pagina) => pagina.texto.replace(/\s+/g, '').length < minimoCaracteres)
    .map((pagina) => pagina.pagina);
}

/** El OCR reemplaza al texto nativo solo si aporta más: una portada "Unidad 3" debe seguir siendo encabezado. */
export function fusionarConOcr(nativas: PaginaExtraida[], leidas: PaginaLeida[]): ResultadoFusion {
  const porNumero = new Map(leidas.map((leida) => [leida.numero, leida]));
  const confianzas: number[] = [];

  const paginas = nativas.map((nativa): PaginaExtraida => {
    const leida = porNumero.get(nativa.pagina);
    if (!leida || largo(leida.texto) <= largo(nativa.texto)) {
      return { pagina: nativa.pagina, texto: nativa.texto, confianza: null };
    }

    confianzas.push(leida.confianza);
    return { pagina: nativa.pagina, texto: leida.texto.trim(), confianza: leida.confianza };
  });

  return {
    paginas,
    origen: paginas.map((pagina) => ({
      pagina: pagina.pagina,
      origen: pagina.confianza === null ? 'nativo' : 'ocr',
      confianza: pagina.confianza ?? null,
    })),
    paginasOcr: confianzas.length,
    confianzaMedia:
      confianzas.length > 0
        ? Math.round((confianzas.reduce((a, b) => a + b, 0) / confianzas.length) * 10_000) / 10_000
        : null,
  };
}

function largo(texto: string): number {
  return texto.replace(/\s+/g, '').length;
}
