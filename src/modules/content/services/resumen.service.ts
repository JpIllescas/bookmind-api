import { Injectable, Logger } from '@nestjs/common';

import { Chapter } from '../../documents/entities/chapter.entity';
import {
  CapitulosService,
  agruparCapitulos,
  nombreDeCapitulo,
} from '../../documents/services/capitulos.service';
import { MlService, PaginaEstudio } from '../../ml/ml.service';

export interface PuntoResumen {
  texto: string;
  pagina: number;
}

/** Un tramo del libro (uno o varios capítulos seguidos) con sus ideas clave. */
export interface SeccionResumen {
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
  puntos: PuntoResumen[];
}

export interface ResumenMotor {
  /** Markdown para el mismo renderizador del chat. */
  texto: string;
  /** Todos los puntos en orden de lectura, para citar y verificar. */
  puntos: PuntoResumen[];
  secciones: SeccionResumen[];
}

/** Más secciones que esto y el resumen deja de leerse de un tirón. */
const MAXIMO_SECCIONES = 10;
/** Un libro corto se resume de una sola pasada. */
const PAGINAS_PARA_SECCIONAR = 20;
const PUNTOS_MINIMOS_SECCION = 3;
const PUNTOS_MAXIMOS_SECCION = 6;
/** Una idea clave por cada tantas páginas, dentro de los límites de arriba. */
const PAGINAS_POR_PUNTO = 6;
/** El ml-service atiende con un solo proceso: más peticiones a la vez solo hacen cola. */
const TRAMOS_EN_PARALELO = 4;

/**
 * Resumen extractivo proporcional al libro: un tramo por capítulo (o grupo de
 * capítulos) para que 260 páginas no queden en ocho líneas.
 */
@Injectable()
export class ResumenService {
  private readonly logger = new Logger(ResumenService.name);

  constructor(
    private readonly capitulos: CapitulosService,
    private readonly ml: MlService,
  ) {}

  /** Null si el motor no responde o no encontró nada que resumir. */
  async generar(documentId: string, paginas: PaginaEstudio[]): Promise<ResumenMotor | null> {
    if (paginas.length === 0) return null;

    const capitulos = await this.capitulos.listar(documentId);
    const tramos = this.tramosDe(capitulos, paginas);

    const secciones: SeccionResumen[] = [];

    for (let i = 0; i < tramos.length; i += TRAMOS_EN_PARALELO) {
      const lote = await Promise.all(
        tramos.slice(i, i + TRAMOS_EN_PARALELO).map((tramo) => this.resumirTramo(tramo, paginas)),
      );
      secciones.push(...lote.filter((s): s is SeccionResumen => s !== null));
    }

    if (secciones.length === 0) return null;

    return {
      texto: this.comoMarkdown(secciones),
      puntos: secciones.flatMap((s) => s.puntos),
      secciones,
    };
  }

  /** Un libro corto se resume de una sola pasada; el resto, por tramos de capítulos. */
  private tramosDe(capitulos: Chapter[], paginas: PaginaEstudio[]): Omit<SeccionResumen, 'puntos'>[] {
    const primera = paginas[0].pagina;
    const ultima = paginas[paginas.length - 1].pagina;

    if (capitulos.length <= 1 || paginas.length < PAGINAS_PARA_SECCIONAR) {
      const titulo = capitulos[0] ? nombreDeCapitulo(capitulos[0]) : 'El libro';
      return [{ titulo, paginaInicio: primera, paginaFin: ultima }];
    }

    return agruparCapitulos(capitulos, MAXIMO_SECCIONES).map(
      ({ titulo, paginaInicio, paginaFin }) => ({ titulo, paginaInicio, paginaFin }),
    );
  }

  private async resumirTramo(
    tramo: Omit<SeccionResumen, 'puntos'>,
    paginas: PaginaEstudio[],
  ): Promise<SeccionResumen | null> {
    const propias = paginas.filter(
      (p) => p.pagina >= tramo.paginaInicio && p.pagina <= tramo.paginaFin,
    );
    if (propias.length === 0) return null;

    const cantidad = Math.min(
      PUNTOS_MAXIMOS_SECCION,
      Math.max(PUNTOS_MINIMOS_SECCION, Math.ceil(propias.length / PAGINAS_POR_PUNTO)),
    );

    const resultado = await this.ml.estudio<{ texto: unknown; pagina: unknown }>(
      'summary',
      propias,
      cantidad,
    );

    if (!resultado) {
      this.logger.warn(`Sin resumen para el tramo "${tramo.titulo}": el motor no respondió.`);
      return null;
    }

    const puntos = (resultado.items ?? [])
      .map((p) => ({ texto: String(p.texto ?? '').trim(), pagina: Number(p.pagina) }))
      .filter((p) => p.texto && Number.isFinite(p.pagina));

    return puntos.length > 0 ? { ...tramo, puntos } : null;
  }

  private comoMarkdown(secciones: SeccionResumen[]): string {
    return secciones
      .map((s) => {
        const rango =
          s.paginaInicio === s.paginaFin
            ? `pág. ${s.paginaInicio}`
            : `págs. ${s.paginaInicio}–${s.paginaFin}`;
        const puntos = s.puntos.map((p) => `- ${p.texto} (pág. ${p.pagina})`).join('\n');
        return `### ${s.titulo} (${rango})\n${puntos}`;
      })
      .join('\n\n');
  }
}
