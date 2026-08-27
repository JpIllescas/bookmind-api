import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentsService } from '../documents/documents.service';
import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import type { LlmProvider } from '../chat/providers/llm-provider.interface';
import { GeneratedContent, GeneratedContentType } from './entities/generated-content.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class ContentService {
  constructor(@InjectRepository(GeneratedContent) private readonly contents: Repository<GeneratedContent>, private readonly documents: DocumentsService, private readonly users: UsersService, @Inject(LLM_PROVIDER) private readonly llm: LlmProvider) {}
  async generar(userId: string, documentId: string, type: GeneratedContentType) {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const preferencias = await this.users.obtenerPreferencias(userId);
    const instruction = type === 'summary' ? 'Genera un resumen claro en 5 puntos.' : type === 'flashcards' ? 'Genera 10 flashcards como JSON array [{"question":"...","answer":"..."}].' : 'Genera un quiz de 5 preguntas como JSON array [{"question":"...","options":["..."],"answer":"..."}].';
    const raw = await this.llm.responder({ systemPrompt: `${instruction}\nAdapta la dificultad y el formato a estas preferencias: ${JSON.stringify(preferencias ?? {})}. Responde en español y usa únicamente este texto:\n${document.extractedText.slice(0, 500000)}`, historial: [], mensaje: instruction });
    let content: unknown = raw;
    try { content = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()); } catch { /* plain text is valid for summaries and provider fallbacks */ }
    return this.contents.save(this.contents.create({ documentId, userId, type, content }));
  }
  listar(userId: string, documentId: string) { return this.contents.find({ where: { userId, documentId }, order: { createdAt: 'DESC' } }); }
}
