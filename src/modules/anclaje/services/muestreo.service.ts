import { Injectable } from '@nestjs/common';

import { EmbeddingsService } from './embeddings.service';

export interface Candidato {
  embedding: number[];
  /** Lo que cuesta incluirlo en el contexto. */
  caracteres: number;
}

/** Peso de la relevancia frente a la novedad; 0.5 las reparte por igual. */
const LAMBDA = 0.5;

/** Elige fragmentos representativos de un libro entero sin llamar a ningún modelo. */
@Injectable()
export class MuestreoService {
  /**
   * Maximal Marginal Relevance contra el centroide del libro: cada elección se
   * parece al conjunto y se aleja de lo ya elegido. Devuelve índices en el orden elegido.
   */
  seleccionar(candidatos: Candidato[], presupuesto: number): number[] {
    if (candidatos.length === 0) return [];

    const centro = EmbeddingsService.promedio(candidatos.map((c) => c.embedding));
    const relevancia = candidatos.map((c) => EmbeddingsService.coseno(c.embedding, centro));

    // Mayor parecido de cada candidato con lo ya elegido; 0 mientras no hay nada.
    const redundancia = new Array<number>(candidatos.length).fill(0);
    const elegido = new Array<boolean>(candidatos.length).fill(false);
    const elegidos: number[] = [];
    let usados = 0;

    while (elegidos.length < candidatos.length) {
      let mejor = -1;
      let mejorPuntaje = -Infinity;

      for (let i = 0; i < candidatos.length; i += 1) {
        if (elegido[i]) continue;

        const puntaje = LAMBDA * relevancia[i] - (1 - LAMBDA) * redundancia[i];
        if (puntaje > mejorPuntaje) {
          mejorPuntaje = puntaje;
          mejor = i;
        }
      }

      // Siempre entra al menos uno; después, solo lo que quepa.
      if (elegidos.length > 0 && usados + candidatos[mejor].caracteres > presupuesto) break;

      elegidos.push(mejor);
      elegido[mejor] = true;
      usados += candidatos[mejor].caracteres;

      for (let j = 0; j < candidatos.length; j += 1) {
        if (elegido[j]) continue;

        redundancia[j] = Math.max(
          redundancia[j],
          EmbeddingsService.coseno(candidatos[j].embedding, candidatos[mejor].embedding),
        );
      }
    }

    return elegidos;
  }
}
