export type TipoMapa = 'mind_map' | 'concept_map';

export interface NodoMapa {
  id: string;
  label: string;
  type: 'root' | 'concept';
  pagina?: number;
}

export interface ConexionMapa {
  source: string;
  target: string;
  label?: string;
}

export interface Mapa {
  type: TipoMapa;
  title: string;
  nodes: NodoMapa[];
  edges: ConexionMapa[];
}

/** El dibujo muestra hasta tres líneas de ~20 caracteres; más que esto se recorta igual. */
const LARGO_ETIQUETA = 56;
const LARGO_RELACION = 28;
const LARGO_TITULO = 90;

function limpiar(valor: unknown): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

/** Recorta en la última palabra completa, para que no quede "Sistema Locom…". */
function recortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > maximo / 2 ? corte.slice(0, espacio) : corte).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Deja el JSON de Gemini en la forma que dibuja el frontend: una sola raíz,
 * etiquetas cortas, sin conexiones rotas ni repetidas, y sin rótulos en el
 * mapa mental (ahí la relación es siempre "parte de"). Null si no queda mapa.
 */
export function normalizarDiagrama(datos: any, type: TipoMapa, tituloPorDefecto: string): Mapa | null {
  const ids = new Set<string>();
  const nodes: NodoMapa[] = [];

  for (const [indice, nodo] of (Array.isArray(datos?.nodes) ? datos.nodes : []).entries()) {
    const id = limpiar(nodo?.id) || `n${indice + 1}`;
    const label = recortar(limpiar(nodo?.label), LARGO_ETIQUETA);
    if (!label || ids.has(id)) continue;
    ids.add(id);
    nodes.push({ id, label, type: limpiar(nodo?.type) === 'root' ? 'root' : 'concept' });
  }

  const vistas = new Set<string>();
  const edges: ConexionMapa[] = [];
  for (const conexion of Array.isArray(datos?.edges) ? datos.edges : []) {
    const source = limpiar(conexion?.source);
    const target = limpiar(conexion?.target);
    const clave = `${source}>${target}`;
    if (!ids.has(source) || !ids.has(target) || source === target || vistas.has(clave)) continue;
    vistas.add(clave);

    const label = type === 'concept_map' ? recortar(limpiar(conexion?.label), LARGO_RELACION) : '';
    edges.push(label ? { source, target, label } : { source, target });
  }

  if (nodes.length < 2 || edges.length === 0) return null;

  // Una sola raíz: la que Gemini marcó, o la que no recibe ninguna conexión.
  const conEntrada = new Set(edges.map((conexion) => conexion.target));
  const raiz = nodes.find((nodo) => nodo.type === 'root') ?? nodes.find((nodo) => !conEntrada.has(nodo.id)) ?? nodes[0];
  for (const nodo of nodes) nodo.type = nodo === raiz ? 'root' : 'concept';

  return {
    type,
    title: recortar(limpiar(datos?.title) || tituloPorDefecto, LARGO_TITULO),
    nodes,
    edges,
  };
}

/** Pone a cada nodo la página que lo respalda; los que no se apoyan en el libro quedan sin página. */
export function conPaginas(mapa: Mapa, citas: { page: number; score: number }[] | null, umbral: number): Mapa {
  if (!citas) return mapa;
  return {
    ...mapa,
    nodes: mapa.nodes.map((nodo, i) => {
      const cita = citas[i];
      return cita && cita.score >= umbral ? { ...nodo, pagina: cita.page } : nodo;
    }),
  };
}
