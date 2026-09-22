import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { UsersService } from '../users/users.service';
import { CreateStudyPlanDto } from './dto/create-study-plan.dto';
import { StudyPlan } from './entities/study-plan.entity';

const SESIONES = 7;

/** Temas fallados que se le pasan al modelo; más allá de esto el plan se dispersa. */
const MAXIMO_A_REPASAR = 6;

interface TareaGenerada {
  title: string;
  description?: string;
  session?: number;
}

@Injectable()
export class StudyService {
  constructor(
    @InjectRepository(StudyPlan) private readonly plans: Repository<StudyPlan>,
    @InjectRepository(QuizAttempt)
    private readonly intentos: Repository<QuizAttempt>,
    private readonly documents: DocumentsService,
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

  async generar(userId: string, documentId: string): Promise<StudyPlan> {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const preferencias = await this.users.obtenerPreferencias(userId);
    const aRepasar = await this.temasFallados(userId, documentId);

    // Una muestra de todo el libro: el plan cubría solo las primeras páginas.
    const contexto = await this.contexto.representativo(documentId, document.extractedText);

    const respuesta = await this.llm.responder({
      systemPrompt: this.prompt(
        this.prompts.instruccionPreferencias(preferencias),
        aRepasar,
        contexto,
      ),
      historial: [],
      mensaje: 'Genera el plan de estudio.',
    });

    const datos = this.comoPlan(respuesta);

    return this.plans.save(
      this.plans.create({
        userId,
        title: datos.title ?? `Plan: ${document.title}`,
        targetDate: null,
        tasks: datos.tasks,
        active: true,
      }),
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

  private prompt(
    criterios: string,
    aRepasar: string[],
    contexto: ContextoRepresentativo,
  ): string {
    // Sin esto el plan sale igual para quien domina el libro y para quien no.
    const refuerzo =
      aRepasar.length > 0
        ? `El estudiante ya resolvió un quiz de este libro y falló en esto:\n` +
          `${aRepasar.map((tema) => `- ${tema}`).join('\n')}\n` +
          `Dedica las primeras sesiones a eso antes de avanzar con el resto.\n`
        : '';

    return (
      `Genera un plan de estudio de ${SESIONES} sesiones sobre este libro. ` +
      'Devuelve SOLO JSON válido, sin texto alrededor ni ```, con esta forma: ' +
      '{"title":"...","tasks":[{"title":"...","description":"...","session":1}]}\n' +
      `${refuerzo}` +
      `Adapta el plan a estos criterios: ${criterios}\n` +
      this.contexto.aviso(contexto.esParcial) +
      'Usa únicamente el contenido del libro:\n' +
      contexto.contenido
    );
  }

  /**
   * Antes, un JSON ilegible se rellenaba con tareas genéricas que no salían del
   * libro. Es preferible fallar: un plan inventado no es un plan personalizado.
   */
  private comoPlan(crudo: string): { title?: string; tasks: TareaGenerada[] } {
    const limpio = crudo
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    let datos: { title?: string; tasks?: unknown[] };

    try {
      datos = JSON.parse(limpio) as { title?: string; tasks?: unknown[] };
    } catch {
      throw this.malFormato();
    }

    const tasks = (Array.isArray(datos.tasks) ? datos.tasks : [])
      .map((tarea) => tarea as Partial<TareaGenerada>)
      .filter((tarea) => typeof tarea?.title === 'string' && tarea.title.trim() !== '')
      .map((tarea, indice) => ({
        title: tarea.title as string,
        description: tarea.description ?? '',
        session: typeof tarea.session === 'number' ? tarea.session : indice + 1,
      }));

    if (tasks.length === 0) throw this.malFormato();

    return { title: datos.title, tasks };
  }

  private malFormato(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'El asistente devolvió el plan en un formato que no se pudo leer. ' +
        'Vuelve a generarlo.',
    );
  }
}
