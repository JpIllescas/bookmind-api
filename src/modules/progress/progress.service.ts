import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatMessage } from '../chat/entities/chat-message.entity';
import { QuizAttempt } from '../content/entities/quiz-attempt.entity';
import { Document } from '../documents/entities/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { UpdateProgressDto } from './dto/update-progress.dto';

/** Comprensión y anclaje de un libro, calculados sobre lo que el alumno ya hizo. */
interface Senales {
  comprension: number | null;
  quizzes: number;
  aRepasar: string[];
  anclaje: number | null;
}

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(QuizAttempt)
    private readonly intentos: Repository<QuizAttempt>,
    @InjectRepository(ChatMessage)
    private readonly mensajes: Repository<ChatMessage>,
    private readonly documentos: DocumentsService,
  ) {}

  async resumen(userId: string) {
    const documents = await this.documents.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });

    const total = documents.length;
    const completed = documents.filter((d) => d.progress >= 100).length;
    const started = documents.filter((d) => d.progress > 0 && d.progress < 100).length;

    const senales = await this.senalesPorLibro(userId);

    const evaluados = documents
      .map((d) => senales.get(d.id)?.comprension)
      .filter((valor): valor is number => valor !== null && valor !== undefined);

    return {
      // La misma forma que consume la biblioteca: tinte, etiqueta y estado incluidos.
      documents: documents.map((d) => ({
        ...this.documentos.comoResumen(d),
        ...(senales.get(d.id) ?? {
          comprension: null,
          quizzes: 0,
          aRepasar: [],
          anclaje: null,
        }),
      })),
      total,
      completed,
      started,
      average: total
        ? Math.round(documents.reduce((suma, d) => suma + d.progress, 0) / total)
        : 0,
      /** Aciertos medios en los quiz: mide comprensión, no páginas pasadas. */
      comprension: evaluados.length
        ? Math.round(evaluados.reduce((suma, valor) => suma + valor, 0) / evaluados.length)
        : null,
      librosEvaluados: evaluados.length,
    };
  }

  /**
   * Comprensión: aciertos del último intento de cada libro. Anclaje: cuánto de
   * lo que respondió el asistente estaba respaldado por ese libro.
   */
  private async senalesPorLibro(userId: string): Promise<Map<string, Senales>> {
    const [intentos, anclados] = await Promise.all([
      this.intentos.find({ where: { userId }, order: { createdAt: 'DESC' } }),
      this.mensajes.find({
        where: { userId },
        select: { documentId: true, groundingScore: true },
      }),
    ]);

    const senales = new Map<string, Senales>();

    for (const intento of intentos) {
      const previo = senales.get(intento.documentId);

      // Vienen ordenados: el primero de cada libro es el más reciente.
      senales.set(intento.documentId, {
        comprension:
          previo?.comprension ??
          Math.round((intento.aciertos / intento.total) * 100),
        quizzes: (previo?.quizzes ?? 0) + 1,
        aRepasar:
          previo?.aRepasar ?? intento.falladas.map((fallada) => fallada.pregunta),
        anclaje: null,
      });
    }

    const puntajes = new Map<string, number[]>();

    for (const mensaje of anclados) {
      if (mensaje.groundingScore === null) continue;

      const lista = puntajes.get(mensaje.documentId) ?? [];
      lista.push(mensaje.groundingScore);
      puntajes.set(mensaje.documentId, lista);
    }

    for (const [documentId, lista] of puntajes) {
      const media = lista.reduce((suma, valor) => suma + valor, 0) / lista.length;

      const previo = senales.get(documentId);

      senales.set(documentId, {
        comprension: previo?.comprension ?? null,
        quizzes: previo?.quizzes ?? 0,
        aRepasar: previo?.aRepasar ?? [],
        anclaje: Math.round(media * 100),
      });
    }

    return senales;
  }

  async actualizar(userId: string, id: string, dto: UpdateProgressDto) {
    const documento = await this.documents.findOneBy({ id, userId });

    if (!documento) {
      throw new NotFoundException('No se encontró el documento.');
    }

    documento.progress = dto.progress;
    await this.documents.save(documento);

    return this.documentos.comoResumen(documento);
  }
}
