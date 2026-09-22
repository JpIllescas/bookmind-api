import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolMensaje } from '../../common/enums/rol-mensaje.enum';
import { TipoBloque } from '../../common/enums/tipo-bloque.enum';
import { ACCIONES_POR_MATERIA } from '../../common/utils/taxonomia.util';
import { Materia } from '../../common/enums/materia.enum';
import { AnclajeService } from '../anclaje/anclaje.service';
import { DocumentsService } from '../documents/documents.service';
import { Document } from '../documents/entities/document.entity';
import { CapitulosService, nombreDeCapitulo } from '../documents/services/capitulos.service';
import { UsersService } from '../users/users.service';
import { ChatMessage, Cita } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { LLM_PROVIDER, streamDesdeRespuesta } from './providers/llm-provider.interface';
import type { LlmProvider } from './providers/llm-provider.interface';
import { ConversacionesService } from './services/conversaciones.service';
import { MaterialPedido, IntencionService } from './services/intencion.service';
import { PromptService } from './services/prompt.service';

// Por encima de esto se recupera por fragmentos; hasta aquí el modelo lee el libro entero.
const MAXIMO_ZERO_RAG = 150_000;

/** Pasajes que se recuperan por pregunta; con menos, una pregunta amplia se quedaba corta. */
const PASAJES_POR_PREGUNTA = 18;

const TURNOS_DE_HISTORIAL = 10;

/** El material vive en el Studio, no en el hilo: el aviso solo dice dónde buscarlo. */
const AVISO_MATERIAL: Record<MaterialPedido, string> = {
  [TipoBloque.Summary]: 'Estoy preparando el resumen en el Studio.',
  [TipoBloque.Flashcards]: 'Estoy preparando tus flashcards en el Studio.',
  [TipoBloque.Quiz]: 'Estoy preparando tu quiz en el Studio.',
  [TipoBloque.Glossary]: 'Estoy preparando el glosario en el Studio.',
  [TipoBloque.Timeline]: 'Estoy preparando la línea de tiempo en el Studio.',
};

export interface RespuestaChat {
  id: string;
  conversationId: string;
  response: string;
  blockType: TipoBloque;
  groundingScore: number | null;
  citations: Cita[];
  flaggedClaims: string[];
  contextoParcial: boolean;
}

/** Lo que va saliendo por el stream, en el orden en que se produce. */
export type EventoChat =
  | { tipo: 'inicio'; conversationId: string; mensajeUsuarioId: string }
  | { tipo: 'token'; texto: string }
  | { tipo: 'material'; blockType: MaterialPedido }
  | { tipo: 'anclaje'; groundingScore: number | null; citations: Cita[]; flaggedClaims: string[] }
  | { tipo: 'fin'; id: string; contextoParcial: boolean; titulo: string }
  | { tipo: 'error'; mensaje: string };

interface Turno {
  documento: Document;
  systemPrompt: string;
  historial: ChatMessage[];
  esParcial: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatMessage)
    private readonly mensajes: Repository<ChatMessage>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly documentos: DocumentsService,
    private readonly capitulos: CapitulosService,
    private readonly anclaje: AnclajeService,
    private readonly prompts: PromptService,
    private readonly intencion: IntencionService,
    private readonly usuarios: UsersService,
    private readonly conversaciones: ConversacionesService,
  ) {}

  /** Respuesta completa de una vez; el camino sin streaming sigue existiendo para la API. */
  async responder(
    userId: string,
    documentId: string,
    mensaje: string,
    conversationId?: string,
  ): Promise<RespuestaChat> {
    const conversacion = await this.resolverConversacion(userId, documentId, conversationId);
    const materiales = this.intencion.detectar(mensaje);

    if (materiales.length > 0) {
      return this.pedirMaterial(userId, conversacion, mensaje, materiales);
    }

    const turno = await this.prepararTurno(userId, conversacion, mensaje);
    const respuesta = await this.llm.responder(this.peticionDe(turno, mensaje));
    const guardada = await this.cerrarTurno(userId, conversacion, mensaje, respuesta);

    return {
      id: guardada.id,
      conversationId: conversacion.id,
      response: respuesta,
      blockType: guardada.blockType,
      groundingScore: guardada.groundingScore,
      citations: guardada.citations ?? [],
      flaggedClaims: guardada.flaggedClaims ?? [],
      contextoParcial: turno.esParcial,
    };
  }

  /**
   * La misma respuesta, pero entregada por eventos según el modelo la produce.
   * El anclaje se calcula al final, cuando ya hay texto completo que verificar.
   */
  async responderEnStream(
    userId: string,
    documentId: string,
    mensaje: string,
    emitir: (evento: EventoChat) => void,
    senal: AbortSignal,
    conversationId?: string,
  ): Promise<void> {
    const conversacion = await this.resolverConversacion(userId, documentId, conversationId);
    const materiales = this.intencion.detectar(mensaje);

    if (materiales.length > 0) {
      const respuesta = await this.pedirMaterial(userId, conversacion, mensaje, materiales);
      emitir({ tipo: 'inicio', conversationId: conversacion.id, mensajeUsuarioId: '' });
      emitir({ tipo: 'material', blockType: materiales[0] });
      emitir({ tipo: 'token', texto: respuesta.response });
      emitir({ tipo: 'fin', id: respuesta.id, contextoParcial: false, titulo: conversacion.titulo });
      return;
    }

    const turno = await this.prepararTurno(userId, conversacion, mensaje);

    const mensajeUsuario = await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.User,
        content: mensaje,
        blockType: TipoBloque.Text,
      }),
    );

    emitir({ tipo: 'inicio', conversationId: conversacion.id, mensajeUsuarioId: mensajeUsuario.id });

    const peticion = { ...this.peticionDe(turno, mensaje), senal };
    const flujo = this.llm.responderStream
      ? this.llm.responderStream(peticion)
      : streamDesdeRespuesta(this.llm, peticion);

    let texto = '';

    try {
      for await (const trozo of flujo) {
        texto += trozo;
        emitir({ tipo: 'token', texto: trozo });
      }
    } catch (error) {
      // Sin respuesta la pregunta no se conserva: al reintentar se guardaría dos veces.
      await this.mensajes.delete(mensajeUsuario.id);
      throw error;
    }

    // Si el estudiante cortó, lo escrito hasta ahí se guarda igual: puede releerlo.
    const anclada = await this.anclaje.verificar(conversacion.documentId, texto);

    const guardada = await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.Assistant,
        content: texto,
        blockType: TipoBloque.Text,
        groundingScore: anclada.groundingScore,
        citations: anclada.citations,
        flaggedClaims: anclada.flaggedClaims,
      }),
    );

    await this.conversaciones.registrarActividad(conversacion, mensaje);
    const actualizada = await this.conversaciones.obtener(userId, conversacion.documentId, conversacion.id);

    emitir({
      tipo: 'anclaje',
      groundingScore: anclada.groundingScore,
      citations: anclada.citations,
      flaggedClaims: anclada.flaggedClaims,
    });
    emitir({
      tipo: 'fin',
      id: guardada.id,
      contextoParcial: turno.esParcial,
      titulo: actualizada.titulo,
    });
  }

  async accionesRapidas(userId: string, documentId: string): Promise<string[]> {
    const documento = await this.documentos.obtener(userId, documentId);
    return ACCIONES_POR_MATERIA[documento.materia ?? Materia.Otro];
  }

  /**
   * Preguntas para arrancar, armadas desde los capítulos del libro: no gastan
   * cuota y llevan al estudiante a las partes concretas del texto.
   */
  async sugerencias(userId: string, documentId: string): Promise<string[]> {
    const documento = await this.documentos.obtener(userId, documentId);
    const capitulos = await this.capitulos.listar(documentId);

    const generales = [
      `¿De qué trata "${documento.title}" en pocas palabras?`,
      'Explícame las ideas más importantes del libro y cómo se relacionan',
      '¿Qué debería recordar de este libro para un examen?',
    ];

    // Capítulos del medio del libro: los primeros ya se ven al abrirlo.
    const desdeCapitulos = capitulos
      .filter((c) => c.titulo.trim().length > 3)
      .slice(0, 6)
      .map((c) => `Resume y explica "${nombreDeCapitulo(c)}"`);

    return [...generales, ...desdeCapitulos].slice(0, 6);
  }

  // --- Piezas del turno ---

  private async resolverConversacion(
    userId: string,
    documentId: string,
    conversationId?: string,
  ): Promise<Conversation> {
    return conversationId
      ? this.conversaciones.obtener(userId, documentId, conversationId)
      : this.conversaciones.crear(userId, documentId);
  }

  private async prepararTurno(
    userId: string,
    conversacion: Conversation,
    mensaje: string,
  ): Promise<Turno> {
    const documento = await this.documentos.obtenerConTexto(userId, conversacion.documentId);
    const preferencias = await this.usuarios.obtenerPreferencias(userId);

    const { contenido, esParcial } = await this.armarContexto(
      conversacion.documentId,
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

    const historial = await this.historialReciente(conversacion.id);

    return { documento, systemPrompt, historial, esParcial };
  }

  private peticionDe(turno: Turno, mensaje: string) {
    return {
      systemPrompt: turno.systemPrompt,
      historial: turno.historial.map((m) => ({
        rol: m.role === RolMensaje.User ? ('user' as const) : ('assistant' as const),
        contenido: m.content,
      })),
      mensaje,
    };
  }

  /** Guarda pregunta y respuesta verificada; devuelve la respuesta ya con anclaje. */
  private async cerrarTurno(
    userId: string,
    conversacion: Conversation,
    mensaje: string,
    respuesta: string,
  ): Promise<ChatMessage> {
    const anclada = await this.anclaje.verificar(conversacion.documentId, respuesta);

    await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.User,
        content: mensaje,
        blockType: TipoBloque.Text,
      }),
    );

    const guardada = await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.Assistant,
        content: respuesta,
        blockType: TipoBloque.Text,
        groundingScore: anclada.groundingScore,
        citations: anclada.citations,
        flaggedClaims: anclada.flaggedClaims,
      }),
    );

    await this.conversaciones.registrarActividad(conversacion, mensaje);

    return guardada;
  }

  /**
   * El material lo genera el frontend con el endpoint de siempre: aquí no se
   * llama al modelo, así que reconocer la intención no gasta cuota.
   */
  private async pedirMaterial(
    userId: string,
    conversacion: Conversation,
    mensaje: string,
    tipos: MaterialPedido[],
  ): Promise<RespuestaChat> {
    const [tipo, ...resto] = tipos;

    await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.User,
        content: mensaje,
        blockType: TipoBloque.Text,
      }),
    );

    const guardada = await this.mensajes.save(
      this.mensajes.create({
        documentId: conversacion.documentId,
        conversationId: conversacion.id,
        userId,
        role: RolMensaje.Assistant,
        content:
          AVISO_MATERIAL[tipo] +
          // Solo se prepara uno: cada material es una generación aparte.
          (resto.length > 0 ? ' Lo demás lo puedes pedir desde el Studio.' : ''),
        blockType: tipo,
      }),
    );

    await this.conversaciones.registrarActividad(conversacion, mensaje);

    return {
      id: guardada.id,
      conversationId: conversacion.id,
      response: guardada.content,
      blockType: tipo,
      groundingScore: null,
      citations: [],
      flaggedClaims: [],
      contextoParcial: false,
    };
  }

  private async armarContexto(
    documentId: string,
    textoCompleto: string,
    mensaje: string,
  ): Promise<{ contenido: string; esParcial: boolean }> {
    if (textoCompleto.length <= MAXIMO_ZERO_RAG) {
      // Con marcas de página el modelo puede citar; el texto plano del documento no las tiene.
      const paginas = await this.capitulos.paginasDe(documentId);
      const contenido =
        paginas.length > 0
          ? paginas.map((p) => `[Página ${p.pagina}]\n${p.texto}`).join('\n\n')
          : textoCompleto;

      return { contenido, esParcial: false };
    }

    const pasajes = await this.anclaje.recuperar(documentId, mensaje, PASAJES_POR_PREGUNTA);

    if (pasajes.length === 0) {
      this.logger.warn(
        `Documento ${documentId} sin fragmentos: se recorta el texto en vez de recuperar.`,
      );
      return { contenido: textoCompleto.slice(0, MAXIMO_ZERO_RAG), esParcial: true };
    }

    // En orden de lectura: el modelo sigue mejor el hilo del libro que el ranking.
    const contenido = [...pasajes]
      .sort((a, b) => a.pagina - b.pagina)
      .map((p) => `[Página ${p.pagina}]\n${p.texto}`)
      .join('\n\n');

    return { contenido, esParcial: true };
  }

  private historialReciente(conversationId: string): Promise<ChatMessage[]> {
    return this.mensajes
      .find({
        where: { conversationId },
        order: { createdAt: 'DESC' },
        take: TURNOS_DE_HISTORIAL,
      })
      .then((mensajes) => mensajes.reverse());
  }
}
