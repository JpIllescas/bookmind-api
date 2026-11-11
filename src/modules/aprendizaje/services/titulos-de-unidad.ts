/** "CCNN_U1", "Ciencias 4to grado U2": la abreviatura del libro seguida de "U" y el número de unidad. */
const UNIDAD_ABREVIADA = /^(.*?)[\s_]+U(\d{1,2})$/i;

function enOracion(texto: string): string {
  // Solo lo escrito todo en mayúsculas: "ANEXOS" pasa a "Anexos", "La célula" se respeta.
  if (texto !== texto.toUpperCase()) return texto;
  return texto.charAt(0) + texto.slice(1).toLowerCase();
}

/**
 * Los marcadores del PDF a veces son nombres de archivo ("CCNN_U1", "CCNN_ANEXOS").
 * Si al menos dos títulos comparten ese patrón, se les quita la abreviatura y la "U" se lee "Unidad".
 */
export function titulosDeUnidad(titulos: string[]): string[] {
  const prefijos = titulos.flatMap((titulo) => {
    const partes = UNIDAD_ABREVIADA.exec(titulo.trim());
    return partes ? [partes[1].toLowerCase()] : [];
  });
  const prefijo = prefijos.find((candidato, i) => prefijos.indexOf(candidato) !== i);

  return titulos.map((titulo) => {
    const limpio = titulo.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (prefijo === undefined) return limpio || titulo;

    const comun = prefijo.replace(/_/g, ' ');
    const sinPrefijo = limpio.toLowerCase().startsWith(`${comun} `) ? limpio.slice(comun.length + 1) : limpio;
    const unidad = /^U(\d{1,2})$/i.exec(sinPrefijo);

    return unidad ? `Unidad ${Number(unidad[1])}` : enOracion(sinPrefijo) || limpio;
  });
}
