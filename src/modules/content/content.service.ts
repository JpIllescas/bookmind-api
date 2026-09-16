import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentsService } from '../documents/documents.service';
import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import type { LlmProvider } from '../chat/providers/llm-provider.interface';
import { PromptService } from '../chat/services/prompt.service';
import { UsersService } from '../users/users.service';
import { RegistrarIntentoDto } from './dto/registrar-intento.dto';
import {
  GeneratedContent,
  GeneratedContentType,
} from './entities/generated-content.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';

/** Lo que el frontend puede dar por hecho de cada tipo de material. */
export interface Tarjeta {
  pregunta: string;
  respuesta: string;
}

export interface PreguntaQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
}

// Igual que el chat: mandar el libro entero encarecía cada material sin mejorarlo.
const CARACTERES_MAXIMOS = 40_000;

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(GeneratedContent)
    private readonly contents: Repository<GeneratedContent>,
    @InjectRepository(QuizAttempt)
    private readonly intentos: Repository<QuizAttempt>,
    private readonly documents: DocumentsService,
    private readonly users: UsersService,
    private readonly prompts: PromptService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async generar(userId: string, documentId: string, type: GeneratedContentType) {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const preferencias = await this.users.obtenerPreferencias(userId);

    // La misma traducción que usan los planes: aquí sí se habla de sesiones.
    const criterios = this.prompts.instruccionPreferencias(preferencias);

    const crudo = await this.llm.responder({
      systemPrompt:
        `${this.instruccion(type)}\n` +
        `${this.formato(type)}` +
        `Adapta la dificultad a estos criterios: ${criterios}\n` +
        'Responde en español y usa únicamente este texto:\n' +
        document.extractedText.slice(0, CARACTERES_MAXIMOS),
      historial: [],
      mensaje: this.instruccion(type),
    });

    return this.contents.save(
      this.contents.create({
        documentId,
        userId,
        type,
        content: this.normalizar(type, crudo),
      }),
    );
  }

  listar(userId: string, documentId: string) {
    return this.contents.find({
      where: { userId, documentId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Guarda un quiz resuelto: es lo que convierte el avance en comprensión. */
  async registrarIntento(
    userId: string,
    documentId: string,
    contentId: string,
    dto: RegistrarIntentoDto,
  ): Promise<QuizAttempt> {
    const material = await this.contents.findOneBy({ id: contentId, userId });

    if (!material) throw new NotFoundException('No se encontró ese material.');

    if (material.type !== 'quiz') {
      throw new BadRequestException('Solo los quiz registran intentos.');
    }

    return this.intentos.save(
      this.intentos.create({
        contentId,
        documentId,
        userId,
        aciertos: Math.min(dto.aciertos, dto.total),
        total: dto.total,
        falladas: dto.falladas,
      }),
    );
  }

  /** Intentos de un libro, del más reciente al más antiguo. */
  intentos_de(userId: string, documentId: string): Promise<QuizAttempt[]> {
    return this.intentos.find({
      where: { userId, documentId },
      order: { createdAt: 'DESC' },
    });
  }

  async eliminar(userId: string, id: string): Promise<void> {
    await this.contents.delete({ id, userId });
  }

  /** El resumen se pinta con el renderizador del chat: puede llevar mapa. */
  private formato(type: GeneratedContentType): string {
    return type === 'summary' ? `${this.prompts.especificacionMapa()}\n` : '';
  }

  private instruccion(type: GeneratedContentType): string {
    if (type === 'summary') {
      return (
        'Resume el libro en 6 a 8 puntos. Cada punto lleva 2 o 3 frases que ' +
        'expliquen la idea, no que solo la enuncien. Abre con un mapa de ideas y ' +
        'después los puntos con viñetas "- " y **negritas**; nada de títulos con ' +
        '#, tablas ni otros bloques.'
      );
    }

    if (type === 'flashcards') {
      return (
        'Genera 10 flashcards. Devuelve SOLO un JSON array, sin texto alrededor ' +
        'ni ```: [{"pregunta":"...","respuesta":"..."}]'
      );
    }

    return (
      'Genera un quiz de 5 preguntas con 4 opciones cada una. Devuelve SOLO un ' +
      'JSON array, sin texto alrededor ni ```: ' +
      '[{"pregunta":"...","opciones":["a","b","c","d"],"correcta":0}] ' +
      'donde "correcta" es el índice de la opción correcta, empezando en 0.'
    );
  }

  /** Deja siempre la misma forma; si el modelo se sale del formato, falla claro. */
  private normalizar(type: GeneratedContentType, crudo: string): unknown {
    if (type === 'summary') return { texto: crudo.trim() };

    const datos = this.comoJson(crudo);

    if (type === 'flashcards') {
      const tarjetas = datos
        .map((item) => ({
          pregunta: String(item?.pregunta ?? item?.question ?? '').trim(),
          respuesta: String(item?.respuesta ?? item?.answer ?? '').trim(),
        }))
        .filter((tarjeta) => tarjeta.pregunta && tarjeta.respuesta);

      if (tarjetas.length === 0) throw this.malFormato();

      return { tarjetas };
    }

    const preguntas = datos
      .map((item) => {
        const opciones = (Array.isArray(item?.opciones) ? item.opciones : item?.options)
          ?.map((opcion: unknown) => String(opcion).trim())
          .filter(Boolean) as string[] | undefined;

        return {
          pregunta: String(item?.pregunta ?? item?.question ?? '').trim(),
          opciones: opciones ?? [],
          correcta: this.indiceCorrecto(item, opciones ?? []),
        };
      })
      .filter((p) => p.pregunta && p.opciones.length >= 2);

    if (preguntas.length === 0) throw this.malFormato();

    return { preguntas };
  }

  /** El índice puede venir como número o como el texto de la opción correcta. */
  private indiceCorrecto(item: any, opciones: string[]): number {
    const valor = item?.correcta ?? item?.answer;

    if (typeof valor === 'number' && valor >= 0 && valor < opciones.length) {
      return valor;
    }

    const indice = opciones.findIndex(
      (opcion) => opcion.toLowerCase() === String(valor).trim().toLowerCase(),
    );

    return indice >= 0 ? indice : 0;
  }

  private comoJson(crudo: string): any[] {
    const limpio = crudo
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    try {
      const datos: unknown = JSON.parse(limpio);
      if (!Array.isArray(datos)) throw this.malFormato();
      return datos;
    } catch {
      throw this.malFormato();
    }
  }

  private malFormato(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'El asistente devolvió el material en un formato que no se pudo leer. ' +
        'Vuelve a generarlo.',
    );
  }
}
