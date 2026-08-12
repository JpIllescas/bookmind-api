import { Injectable } from '@nestjs/common';

import { PaginaExtraida } from '../../documents/services/extraccion.service';

export interface Fragmento {
  indice: number;
  pagina: number;
  texto: string;
}

/** Palabras por fragmento: con contexto propio, pero sin abarcar media página. */
const PALABRAS_POR_FRAGMENTO = 110;

/** Palabras repetidas entre fragmentos vecinos. */
const SOLAPE = 20;

/** Un fragmento con menos que esto es ruido de extracción. */
const MINIMO_PALABRAS = 15;

@Injectable()
export class FragmentacionService {
  /** Parte cada página por separado para no perder de dónde salió el fragmento. */
  fragmentar(paginas: PaginaExtraida[]): Fragmento[] {
    const fragmentos: Fragmento[] = [];
    let indice = 0;

    for (const pagina of paginas) {
      const palabras = pagina.texto.split(/\s+/).filter(Boolean);
      if (palabras.length < MINIMO_PALABRAS) continue;

      const paso = PALABRAS_POR_FRAGMENTO - SOLAPE;

      for (let i = 0; i < palabras.length; i += paso) {
        const trozo = palabras.slice(i, i + PALABRAS_POR_FRAGMENTO);

        // La cola corta de la página ya viene en el solape del fragmento previo.
        if (trozo.length < MINIMO_PALABRAS) break;

        fragmentos.push({
          indice: indice++,
          pagina: pagina.pagina,
          texto: trozo.join(' '),
        });

        if (i + PALABRAS_POR_FRAGMENTO >= palabras.length) break;
      }
    }

    return fragmentos;
  }
}
