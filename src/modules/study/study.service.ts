import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import type { LlmProvider } from '../chat/providers/llm-provider.interface';
import {
  ContextoRepresentativo,
  ContextoService,
} from '../chat/services/contexto.service';
import { PromptService } from '../chat/services/prompt.service';
import { QuizAttempt } from '../content/entities/quiz-attempt.entity';
import { DocumentsService } from '../documents/documents.service';
import { CapitulosService } from '../documents/services/capitulos.service';
import { UsersService } from '../users/users.service';
import { CreateStudyPlanDto } from './dto/create-study-plan.dto';
import { StudyPlan } from './entities/study-plan.entity';
import { TareaPlan, planDesdeElLibro, tramosDelLibro } from './plan-motor';

const SESIONES = 7;

/** Preguntas falladas que entran al plan; más allá de esto la sesión de repaso se dispersa. */
const MAXIMO_A_REPASAR = 6;

@Injectable()
export class StudyService {
  private readonly logger = new Logger(StudyService.name);

  constructor(
    @InjectRepository(StudyPlan) private readonly plans: Repository<StudyPlan>,
    @InjectRepository(QuizAttempt)
    private readonly intentos: Repository<QuizAttempt>,
    private readonly documents: DocumentsService,
    private readonly capitulos: CapitulosService,
    private readonly users: UsersService,
    private readonly prompts: PromptService,
    private readonly contexto: ContextoService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  listar(userId: string): Promise<StudyPlan[]> {
    return this.plans.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  crear(userId: string, dto: CreateStudyPlanDto): Promise<StudyPlan> {
    return this.plans.save(
      this.plans.create({
        userId,
        title: dto.title,
        targetDate: dto.targetDate ?? null,
        tasks: dto.tasks ?? [],
        active: true,
      }),
    );
  }

  /**
   * El motor arma el plan con el libro real (sus capítulos o páginas y lo que el
   * estudiante falló); Gemini, si el estudiante lo tiene encendido, solo lo redacta.
   */
  async generar(userId: string, documentId: string): Promise<StudyPlan> {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const aRepasar = await this.temasFallados(userId, documentId);
    const capitulos = await this.capitulos.listar(documentId);

    const tramos = tramosDelLibro(capitulos, document.pages, SESIONES - (aRepasar.length > 0 ? 1 : 0));
    const plan = planDesdeElLibro(document.title, tramos, aRepasar);
    if (plan.tasks.length === 0) {
      throw new BadRequestException('Este libro todavía no tiene páginas procesadas para armar un plan. Espera a que termine de prepararse.');
    }

    const tareas = (await this.users.usaGemini(userId))
      ? (await this.redactarConGemini(userId, document.id, document.extractedText, plan.tasks)) ?? plan.tasks
      : plan.tasks;

    return this.plans.save(
      this.plans.create({ userId, title: plan.title, targetDate: null, tasks: tareas, active: true }),
    );
  }

  async completar(userId: string, id: string, taskIndex: number): Promise<StudyPlan> {
    const plan = await this.plans.findOneBy({ id, userId });

    if (!plan) throw new NotFoundException('No se encontró el plan.');

    plan.tasks = plan.tasks.map((task, index) =>
      index === taskIndex ? { ...(task as object), completed: true } : task,
    );

    return this.plans.save(plan);
  }

  /** Lo que el estudiante falló en su último quiz de este libro. */
  private async temasFallados(userId: string, documentId: string): Promise<string[]> {
    const ultimo = await this.intentos.findOne({
      where: { userId, documentId },
      order: { createdAt: 'DESC' },
    });

    return (ultimo?.falladas ?? [])
      .map((fallada) => fallada.pregunta)
      .slice(0, MAXIMO_A_REPASAR);
  }

  /** Gemini reescribe las descripciones; títulos, páginas y orden son del motor. Null si no pudo. */
  private async redactarConGemini(
    userId: string,
    documentId: string,
    texto: string,
    tareas: TareaPlan[],
  ): Promise<TareaPlan[] | null> {
    try {
      const preferencias = await this.users.obtenerPreferencias(userId);
      const contexto: ContextoRepresentativo = await this.contexto.representativo(documentId, texto);
      const respuesta = await this.llm.responder({
        systemPrompt:
          'Este es un plan de estudio armado con el libro. Para cada sesión, escribe una descripción de una o dos ' +
          'oraciones que diga qué ideas del libro se van a trabajar y cómo estudiarlas. No cambies los títulos, ' +
          'las páginas ni el orden, y usa solo el contenido del libro. Devuelve SOLO un JSON array con la misma ' +
          'cantidad de elementos, sin texto alrededor ni ```: [{"description":"..."}]\n' +
          `Adapta el registro a estos criterios: ${this.prompts.instruccionPreferencias(preferencias)}\n` +
          `Plan: ${JSON.stringify(tareas.map(({ title, description }) => ({ title, description })))}\n` +
          this.contexto.aviso(contexto.esParcial) +
          contexto.contenido,
        historial: [],
        mensaje: 'Redacta las descripciones del plan.',
      });

      const nuevas = JSON.parse(respuesta.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()) as unknown;
      if (!Array.isArray(nuevas) || nuevas.length !== tareas.length) return null;

      return tareas.map((tarea, i) => {
        const descripcion = String((nuevas[i] as { description?: unknown })?.description ?? '').trim();
        return descripcion ? { ...tarea, description: descripcion } : tarea;
      });
    } catch (error) {
      // Sin Gemini el plan del motor es igual de válido: se registra y se entrega ese.
      this.logger.warn(`Plan de ${documentId} sin redactar por Gemini: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
