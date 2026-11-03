import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentsService } from '../../documents/documents.service';
import {
  CapitulosService,
  TramoCapitulos,
  agruparCapitulos,
} from '../../documents/services/capitulos.service';
import { MlService } from '../../ml/ml.service';
import { Ejercicio, Lesson } from '../entities/lesson.entity';
import { EjerciciosService, ItemFlashcard, ItemQuiz } from './ejercicios.service';

/** Más unidades que esto y la ruta deja de caber en una pantalla razonable. */
export const MAXIMO_UNIDADES = 40;

/** Con menos ejercicios no hay lección: mejor decirlo que dar dos preguntas. */
const MINIMO_EJERCICIOS = 3;

/** Una unidad sin lección se marca con ejercicios vacíos: así no bloquea la ruta ni se vuelve a pedir al motor. */
const SIN_LECCION = 'Esta unidad tiene muy poco texto para armar una lección. Ya puedes seguir con la siguiente.';

/** Se piden de más al motor: algunos ítems no sirven para armar ejercicios. */
const QUIZ_A_PEDIR = 8;
const FLASHCARDS_A_PEDIR = 10;

export interface LeccionArmada {
  chapterId: string;
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
  ejercicios: Ejercicio[];
}

/** Arma y guarda la lección de una unidad; el motor propio pone los ejercicios. */
@Injectable()
export class LeccionesService {
  private readonly logger = new Logger(LeccionesService.name);

  constructor(
    @InjectRepository(Lesson) private readonly lecciones: Repository<Lesson>,
    private readonly documentos: DocumentsService,
    private readonly capitulos: CapitulosService,
    private readonly ml: MlService,
    private readonly ejercicios: EjerciciosService,
  ) {}

  /** Unidades del libro; la unidad se identifica por su primer capítulo. */
  async unidadesDe(documentId: string): Promise<TramoCapitulos[]> {
    return agruparCapitulos(await this.capitulos.listar(documentId), MAXIMO_UNIDADES);
  }

  /** Unidades que ya se intentaron y no dan para una lección. */
  async sinLeccionDe(documentId: string): Promise<Set<string>> {
    const guardadas = await this.lecciones.find({
      where: { documentId },
      select: { chapterId: true, ejercicios: true },
    });
    return new Set(guardadas.filter((l) => l.ejercicios.length === 0).map((l) => l.chapterId));
  }

  async obtener(
    userId: string,
    documentId: string,
    chapterId: string,
    regenerar = false,
  ): Promise<LeccionArmada> {
    await this.documentos.obtener(userId, documentId);

    const unidad = (await this.unidadesDe(documentId)).find((u) => u.id === chapterId);
    if (!unidad) {
      throw new NotFoundException('Esa unidad no existe en este libro.');
    }

    if (!regenerar) {
      const guardada = await this.lecciones.findOneBy({ documentId, chapterId });
      if (guardada?.ejercicios.length === 0) throw new BadRequestException(SIN_LECCION);
      if (guardada) return this.comoRespuesta(unidad, guardada.ejercicios);
    }

    const ejercicios = await this.generar(documentId, unidad, regenerar);
    await this.guardar(documentId, chapterId, ejercicios);
    return this.comoRespuesta(unidad, ejercicios);
  }

  private async guardar(documentId: string, chapterId: string, ejercicios: Ejercicio[]): Promise<void> {
    await this.lecciones.upsert(
      this.lecciones.create({ documentId, chapterId, ejercicios }),
      ['documentId', 'chapterId'],
    );
  }

  private async generar(
    documentId: string,
    unidad: TramoCapitulos,
    regenerar: boolean,
  ): Promise<Ejercicio[]> {
    const paginas = (await this.capitulos.paginasDe(documentId)).filter(
      (p) => p.pagina >= unidad.paginaInicio && p.pagina <= unidad.paginaFin,
    );

    if (paginas.length === 0) {
      await this.guardar(documentId, unidad.id, []);
      throw new BadRequestException(
        'Esta unidad no tiene texto legible para armar una lección. Ya puedes seguir con la siguiente.',
      );
    }

    const [quiz, flashcards] = await Promise.all([
      this.ml.estudio<ItemQuiz>('quiz', paginas, QUIZ_A_PEDIR),
      this.ml.estudio<ItemFlashcard>('flashcards', paginas, FLASHCARDS_A_PEDIR),
    ]);

    if (!quiz && !flashcards) {
      throw new ServiceUnavailableException(
        'El motor de estudio no está disponible ahora mismo. Vuelve a intentarlo en un momento.',
      );
    }

    // La primera lección es siempre la misma; "otra lección" baraja distinto cada vez.
    const ejercicios = this.ejercicios.armar(
      quiz?.items ?? [],
      flashcards?.items ?? [],
      `${documentId}:${unidad.id}:${regenerar ? Date.now() : 0}`,
    );

    if (ejercicios.length < MINIMO_EJERCICIOS) {
      this.logger.warn(`Unidad "${unidad.titulo}" de ${documentId}: solo ${ejercicios.length} ejercicios.`);
      // Si solo respondió uno de los dos generadores, quizá con el otro alcanzaba: no se marca.
      if (!quiz || !flashcards) {
        throw new ServiceUnavailableException(
          'El motor de estudio no respondió completo. Vuelve a intentarlo en un momento.',
        );
      }
      await this.guardar(documentId, unidad.id, []);

      if (quiz.paginasExcluidas > 0) {
        throw new BadRequestException(
          'Varias páginas de esta unidad se digitalizaron con poca calidad y no alcanzan para una lección. ' +
            'Ya puedes seguir con la siguiente unidad.',
        );
      }

      throw new BadRequestException(SIN_LECCION);
    }

    return ejercicios;
  }

  private comoRespuesta(unidad: TramoCapitulos, ejercicios: Ejercicio[]): LeccionArmada {
    return {
      chapterId: unidad.id,
      titulo: unidad.titulo,
      paginaInicio: unidad.paginaInicio,
      paginaFin: unidad.paginaFin,
      ejercicios,
    };
  }
}
