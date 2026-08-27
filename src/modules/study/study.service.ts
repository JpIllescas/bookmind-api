import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateStudyPlanDto } from './dto/create-study-plan.dto';
import { StudyPlan } from './entities/study-plan.entity';
import { DocumentsService } from '../documents/documents.service';
import { UsersService } from '../users/users.service';
import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import type { LlmProvider } from '../chat/providers/llm-provider.interface';

@Injectable()
export class StudyService {
  constructor(@InjectRepository(StudyPlan) private readonly plans: Repository<StudyPlan>, private readonly documents: DocumentsService, private readonly users: UsersService, @Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}
  listar(userId: string) { return this.plans.find({ where: { userId }, order: { createdAt: 'DESC' } }); }
  async crear(userId: string, dto: CreateStudyPlanDto) {
    return this.plans.save(this.plans.create({ userId, title: dto.title, targetDate: dto.targetDate ?? null, tasks: dto.tasks ?? [], active: true }));
  }
  async generar(userId: string, documentId: string) {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const preferencias = await this.users.obtenerPreferencias(userId);
    const prompt = `Genera un plan de estudio de 7 sesiones sobre este libro. Devuelve SOLO JSON válido con esta forma: {"title":"...","tasks":[{"title":"...","description":"...","session":1} ]}. Adapta el plan a estas preferencias: ${JSON.stringify(preferencias ?? {})}. Usa únicamente el contenido del libro.\n${document.extractedText.slice(0, 500000)}`;
    const respuesta = await this.llm.responder({ systemPrompt: prompt, historial: [], mensaje: 'Genera el plan de estudio.' });
    let datos: { title?: string; tasks?: unknown[] } = {};
    try { datos = JSON.parse(respuesta.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()); } catch { /* fallback below */ }
    const tasks = Array.isArray(datos.tasks) && datos.tasks.length > 0 ? datos.tasks : [{ title: 'Leer y resumir el primer tema', session: 1 }, { title: 'Responder preguntas de repaso', session: 2 }];
    return this.plans.save(this.plans.create({ userId, title: datos.title ?? `Plan: ${document.title}`, targetDate: null, tasks, active: true }));
  }
  async completar(userId: string, id: string, taskIndex: number) {
    const plan = await this.plans.findOneBy({ id, userId });
    if (!plan) throw new NotFoundException('No se encontró el plan.');
    const tasks = plan.tasks.map((task, index) => index === taskIndex ? { ...task as object, completed: true } : task);
    plan.tasks = tasks;
    return this.plans.save(plan);
  }
}
