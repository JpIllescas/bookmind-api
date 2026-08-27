import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolMensaje } from '../../common/enums/rol-mensaje.enum';
import { TipoBloque } from '../../common/enums/tipo-bloque.enum';
import { ACCIONES_POR_MATERIA } from '../../common/utils/taxonomia.util';
import { Materia } from '../../common/enums/materia.enum';
import { AnclajeService } from '../anclaje/anclaje.service';
import { DocumentsService } from '../documents/documents.service';
import { ChatMessage } from './entities/chat-message.entity';
import { LLM_PROVIDER } from './providers/llm-provider.interface';
import type { LlmProvider } from './providers/llm-provider.interface';
import { PromptService } from './services/prompt.service';
import { UsersService } from '../users/users.service';

const MAXIMO_ZERO_RAG = 500_000;

const TURNOS_DE_HISTORIAL = 8;

export interface RespuestaChat {
  id: string;
  response: string;
  blockType: TipoBloque;
  groundingScore: number | null;
  citations: { claim: string; page: number; score: number }[];
  flaggedClaims: string[];
  contextoParcial: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly mensajes: Repository<ChatMessage>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly documentos: DocumentsService,
    private readonly anclaje: AnclajeService,
    private readonly prompts: PromptService,
    private readonly usuarios: UsersService,
  ) {}

  async responder(
    userId: string,
    documentId: string,
    mensaje: string,
  ): Promise<RespuestaChat> {

    const documento = await this.documentos.obtenerConTexto(userId, documentId);
    const preferencias = await this.usuarios.obtenerPreferencias(userId);

    const { contenido, esParcial } = await this.armarContexto(
      documentId,
      documento.extractedText,
      mensaje,
    );

    const systemPrompt = this.prompts.construir({
      titulo: documento.title,
      materia: documento.materia,
      nivel: documento.nivel,
      contenido,
      esParcial,
      preferencias,
    });

    const historial = await this.historialReciente(documentId);

    const respuesta = await this.llm.responder({
      systemPrompt,
      historial: historial.map((m) => ({
        rol: m.role === RolMensaje.User ? ('user' as const) : ('assistant' as const),
        contenido: m.content,
      })),
      mensaje,
    });

    const anclada = await this.anclaje.verificar(documentId, respuesta);

    await this.mensajes.save(
      this.mensajes.create({
        documentId,
        userId,
        role: RolMensaje.User,
        content: mensaje,
        blockType: TipoBloque.Text,
      }),
    );

    const guardada = await this.mensajes.save(
      this.mensajes.create({
        documentId,
        userId,
        role: RolMensaje.Assistant,
        content: respuesta,
        blockType: TipoBloque.Text,
        groundingScore: anclada.groundingScore,
        citations: anclada.citations,
        flaggedClaims: anclada.flaggedClaims,
      }),
    );

    return {
      id: guardada.id,
      response: respuesta,
      blockType: guardada.blockType,
      groundingScore: anclada.groundingScore,
      citations: anclada.citations,
      flaggedClaims: anclada.flaggedClaims,
      contextoParcial: esParcial,
    };
  }

  async historial(userId: string, documentId: string) {
    await this.documentos.obtener(userId, documentId);

    const mensajes = await this.mensajes.find({
      where: { documentId },
      order: { createdAt: 'ASC' },
    });

    return mensajes.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      blockType: m.blockType,
      groundingScore: m.groundingScore,
      citations: m.citations,
      flaggedClaims: m.flaggedClaims,
      createdAt: m.createdAt,
    }));
  }

  async accionesRapidas(userId: string, documentId: string): Promise<string[]> {
    const documento = await this.documentos.obtener(userId, documentId);
    return ACCIONES_POR_MATERIA[documento.materia ?? Materia.Otro];
  }

  private async armarContexto(
    documentId: string,
    textoCompleto: string,
    mensaje: string,
  ): Promise<{ contenido: string; esParcial: boolean }> {
    if (textoCompleto.length <= MAXIMO_ZERO_RAG) {
      return { contenido: textoCompleto, esParcial: false };
    }

    const pasajes = await this.anclaje.recuperar(documentId, mensaje, 12);

    if (pasajes.length === 0) {
      this.logger.warn(
        `Documento ${documentId} sin fragmentos: se recorta el texto en vez de recuperar.`,
      );
      return { contenido: textoCompleto.slice(0, MAXIMO_ZERO_RAG), esParcial: true };
    }

    const contenido = pasajes
      .map((p) => `[Página ${p.pagina}]\n${p.texto}`)
      .join('\n\n');

    return { contenido, esParcial: true };
  }

  private historialReciente(documentId: string): Promise<ChatMessage[]> {
    return this.mensajes
      .find({
        where: { documentId },
        order: { createdAt: 'DESC' },
        take: TURNOS_DE_HISTORIAL,
      })
      .then((mensajes) => mensajes.reverse());
  }
}
