import { Injectable, Logger } from '@nestjs/common';

import { AnclajeService } from '../../anclaje/anclaje.service';

/** Techo del contexto: mandar el libro entero encarecía cada material sin mejorarlo. */
export const CARACTERES_MAXIMOS = 40_000;

export interface ContextoRepresentativo {
  contenido: string;
  /** True cuando el modelo recibe una muestra y no el libro completo. */
  esParcial: boolean;
}

/** Contexto para los generadores que no tienen una pregunta que guíe la búsqueda. */
@Injectable()
export class ContextoService {
  private readonly logger = new Logger(ContextoService.name);

  constructor(private readonly anclaje: AnclajeService) {}

  /** Libro corto: entero. Largo: pasajes representativos de todas sus partes, con página. */
  async representativo(
    documentId: string,
    textoCompleto: string,
  ): Promise<ContextoRepresentativo> {
    if (textoCompleto.length <= CARACTERES_MAXIMOS) {
      return { contenido: textoCompleto, esParcial: false };
    }

    const pasajes = await this.anclaje.representativos(documentId, CARACTERES_MAXIMOS);

    if (pasajes.length === 0) {
      this.logger.warn(
        `Documento ${documentId} sin fragmentos: se recorta el texto en vez de muestrear.`,
      );
      return { contenido: textoCompleto.slice(0, CARACTERES_MAXIMOS), esParcial: true };
    }

    const contenido = pasajes
      .map((p) => `[Página ${p.pagina}]\n${p.texto}`)
      .join('\n\n');

    return { contenido, esParcial: true };
  }

  /** Aviso para el prompt cuando el modelo no recibe el libro completo. */
  aviso(esParcial: boolean): string {
    return esParcial
      ? 'NOTA: recibes pasajes representativos de todo el libro, cada uno con su ' +
          'página, no el libro completo. Cubre todas las partes que aparecen, no ' +
          'solo las primeras.\n'
      : '';
  }
}
