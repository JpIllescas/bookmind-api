import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentsService } from '../../documents/documents.service';
import { LessonAttempt } from '../entities/lesson-attempt.entity';
import { RegistrarLeccionDto } from '../dto/registrar-leccion.dto';
import { GamificacionService, ResumenGamificacion } from './gamificacion.service';
import { LeccionesService } from './lecciones.service';

/** Coronas que se pueden ganar por unidad, como en Duolingo. */
export const CORONAS_MAXIMAS = 5;

/** Aciertos mínimos (proporción) para que una lección dé corona. */
const UMBRAL_CORONA = 0.8;

const XP_BASE_LECCION = 10;
const XP_POR_ACIERTO = 2;
const XP_BONUS_PERFECTA = 5;

export type EstadoUnidad = 'bloqueada' | 'disponible' | 'en_curso' | 'aprobada' | 'dominada';

export interface UnidadRuta {
  chapterId: string;
  orden: number;
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
  coronas: number;
  lecciones: number;
  /** Mejor porcentaje de aciertos; null si nunca la hizo. */
  mejor: number | null;
  estado: EstadoUnidad;
}

export interface RutaLibro {
  documento: { id: string; title: string; tintColor: string; etiqueta: string };
  unidades: UnidadRuta[];
  /** Índice de la unidad en la que toca seguir. */
  actual: number;
  coronas: number;
  coronasPosibles: number;
}

/** La ruta de aprendizaje de un libro y el registro de lecciones terminadas. */
@Injectable()
export class RutaService {
  constructor(
    @InjectRepository(LessonAttempt) private readonly intentos: Repository<LessonAttempt>,
    private readonly documentos: DocumentsService,
    private readonly lecciones: LeccionesService,
    private readonly gamificacion: GamificacionService,
  ) {}

  async ruta(userId: string, documentId: string): Promise<RutaLibro> {
    const documento = await this.documentos.obtener(userId, documentId);
    const [unidades, intentos] = await Promise.all([
      this.lecciones.unidadesDe(documentId),
      this.intentos.find({ where: { userId, documentId } }),
    ]);

    const porUnidad = new Map<string, LessonAttempt[]>();
    for (const intento of intentos) {
      porUnidad.set(intento.chapterId, [...(porUnidad.get(intento.chapterId) ?? []), intento]);
    }

    let anteriorAprobada = true;
    let actual = -1;

    const armadas = unidades.map((unidad, indice): UnidadRuta => {
      const propios = porUnidad.get(unidad.id) ?? [];
      const coronas = this.coronasDe(propios);
      const mejor = propios.length
        ? Math.max(...propios.map((i) => Math.round((i.aciertos / i.total) * 100)))
        : null;

      // Se desbloquea al aprobar la anterior; la primera siempre está abierta.
      const desbloqueada = indice === 0 || anteriorAprobada;
      const estado = this.estadoDe(desbloqueada, coronas, propios.length);

      if (actual === -1 && desbloqueada && coronas === 0) actual = indice;
      anteriorAprobada = coronas > 0;

      return {
        chapterId: unidad.id,
        orden: indice + 1,
        titulo: unidad.titulo,
        paginaInicio: unidad.paginaInicio,
        paginaFin: unidad.paginaFin,
        coronas,
        lecciones: propios.length,
        mejor,
        estado,
      };
    });

    const resumen = this.documentos.comoResumen(documento);

    return {
      documento: {
        id: documento.id,
        title: documento.title,
        tintColor: documento.tintColor,
        etiqueta: resumen.etiqueta,
      },
      unidades: armadas,
      // Todo aprobado: se queda en la última para seguir sumando coronas.
      actual: actual === -1 ? Math.max(0, armadas.length - 1) : actual,
      coronas: armadas.reduce((suma, u) => suma + u.coronas, 0),
      coronasPosibles: armadas.length * CORONAS_MAXIMAS,
    };
  }

  /** Guarda la lección terminada y devuelve el XP ganado con el resumen actualizado. */
  async registrar(
    userId: string,
    documentId: string,
    chapterId: string,
    dto: RegistrarLeccionDto,
    desfaseMinutos: number,
  ): Promise<{ xp: number; coronas: number; corona: boolean; resumen: ResumenGamificacion }> {
    await this.documentos.obtener(userId, documentId);

    const aciertos = Math.min(dto.aciertos, dto.total);
    const perfecta = aciertos === dto.total;
    const xp = XP_BASE_LECCION + aciertos * XP_POR_ACIERTO + (perfecta ? XP_BONUS_PERFECTA : 0);

    await this.intentos.save(
      this.intentos.create({ userId, documentId, chapterId, aciertos, total: dto.total, xp }),
    );

    const propios = await this.intentos.find({ where: { userId, documentId, chapterId } });

    return {
      xp,
      coronas: this.coronasDe(propios),
      corona: aciertos / dto.total >= UMBRAL_CORONA,
      resumen: await this.gamificacion.resumen(userId, desfaseMinutos),
    };
  }

  private coronasDe(intentos: LessonAttempt[]): number {
    return Math.min(
      CORONAS_MAXIMAS,
      intentos.filter((i) => i.aciertos / i.total >= UMBRAL_CORONA).length,
    );
  }

  private estadoDe(desbloqueada: boolean, coronas: number, intentos: number): EstadoUnidad {
    if (!desbloqueada) return 'bloqueada';
    if (coronas >= CORONAS_MAXIMAS) return 'dominada';
    if (coronas > 0) return 'aprobada';
    return intentos > 0 ? 'en_curso' : 'disponible';
  }
}
