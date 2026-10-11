/** Constante clásica de RRF: amortigua la ventaja de los primeros puestos. */
export const K_RRF = 60;

/**
 * Reciprocal Rank Fusion: combina rankings de distinta escala (coseno, ts_rank)
 * usando solo la posición. Devuelve el puntaje fusionado por id, sin ordenar.
 */
export function fusionarRangos(
  rankings: string[][],
  k = K_RRF,
): Map<string, number> {
  const puntajes = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((id, posicion) => {
      puntajes.set(id, (puntajes.get(id) ?? 0) + 1 / (k + posicion + 1));
    });
  }

  return puntajes;
}
