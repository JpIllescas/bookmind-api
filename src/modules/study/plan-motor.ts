import { Chapter } from '../documents/entities/chapter.entity';
import { agruparCapitulos } from '../documents/services/capitulos.service';

export interface TareaPlan {
  title: string;
  description: string;
  session: number;
}

export interface Tramo {
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
}

/** Menos páginas que esto por sesión y el plan se vuelve una lista de hojas sueltas. */
const PAGINAS_MINIMAS_POR_SESION = 5;

function rango(inicio: number, fin: number): string {
  return inicio === fin ? `pág. ${inicio}` : `págs. ${inicio}–${fin}`;
}

/** Los tramos del libro: sus capítulos agrupados o, si no tiene, partes parejas por páginas. */
export function tramosDelLibro(capitulos: Chapter[], totalPaginas: number, maximo: number): Tramo[] {
  if (maximo <= 0 || totalPaginas <= 0) return [];
  if (capitulos.length >= 2) {
    return agruparCapitulos(capitulos, maximo).map(({ titulo, paginaInicio, paginaFin }) => ({ titulo, paginaInicio, paginaFin }));
  }

  const partes = Math.max(1, Math.min(maximo, Math.floor(totalPaginas / PAGINAS_MINIMAS_POR_SESION)));
  const porParte = Math.ceil(totalPaginas / partes);
  const tramos: Tramo[] = [];
  for (let inicio = 1; inicio <= totalPaginas; inicio += porParte) {
    const fin = Math.min(totalPaginas, inicio + porParte - 1);
    tramos.push({ titulo: `Páginas ${inicio}–${fin}`, paginaInicio: inicio, paginaFin: fin });
  }
  return tramos;
}

/**
 * El plan que arma el motor con datos reales: primero lo que el estudiante
 * falló en su último quiz y después el libro en orden, con sus páginas.
 */
export function planDesdeElLibro(tituloLibro: string, tramos: Tramo[], aRepasar: string[]): { title: string; tasks: TareaPlan[] } {
  const tasks: TareaPlan[] = [];

  if (aRepasar.length > 0) {
    tasks.push({
      title: 'Repasar lo que fallaste en el último quiz',
      description: `Vuelve a estas preguntas y busca la respuesta en el libro: ${aRepasar.map((tema) => `«${tema}»`).join('; ')}.`,
      session: 1,
    });
  }

  for (const tramo of tramos) {
    tasks.push({
      title: `${tramo.titulo} (${rango(tramo.paginaInicio, tramo.paginaFin)})`,
      description: 'Lee estas páginas, pregúntale al chat lo que no quede claro y cierra con la lección de esta unidad en tu ruta.',
      session: tasks.length + 1,
    });
  }

  return { title: `Plan: ${tituloLibro}`, tasks };
}
