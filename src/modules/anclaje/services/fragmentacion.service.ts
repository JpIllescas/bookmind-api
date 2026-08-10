import { Injectable } from '@nestjs/common';

import { PaginaExtraida } from '../../documents/services/extraccion.service';

export interface Fragmento {
  indice: number;
  pagina: number;
  texto: string;
}

/**
 * Palabras por fragmento. Suficiente para que el pasaje tenga contexto propio
 * y corto para que la cita apunte a un lugar concreto y no a media página.
 */
const PALABRAS_POR_FRAGMENTO = 110;

/** Palabras repetidas entre fragmentos vecinos. */
const SOLAPE = 20;

/** Un fragmento con menos que esto es ruido de extracción. */
const MINIMO_PALABRAS = 15;

@Injectable()
export class FragmentacionService {
  /**
   * Parte el libro en fragmentos, conservando de qué página salió cada uno.
   *
   * Se fragmenta por página y no sobre el texto corrido: mezclar dos páginas
   * en un fragmento haría que la cita apuntara a una de las dos al azar, y la
   * cita es justamente lo que el estudiante va a verificar.
   *
   * Los fragmentos se solapan porque una frase partida justo en el corte
   * quedaría sin contexto en ambos lados y no se parecería a nada.
   */
  fragmentar(paginas: PaginaExtraida[]): Fragmento[] {
    const fragmentos: Fragmento[] = [];
    let indice = 0;

    for (const pagina of paginas) {
      const palabras = pagina.texto.split(/\s+/).filter(Boolean);
      if (palabras.length < MINIMO_PALABRAS) continue;

      const paso = PALABRAS_POR_FRAGMENTO - SOLAPE;

      for (let i = 0; i < palabras.length; i += paso) {
        const trozo = palabras.slice(i, i + PALABRAS_POR_FRAGMENTO);

        // La cola de una página puede quedar muy corta tras el último corte;
        // ya está cubierta por el solape del fragmento anterior.
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
