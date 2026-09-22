import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolMensaje } from '../../../common/enums/rol-mensaje.enum';
import { DocumentsService } from '../../documents/documents.service';
import { ChatMessage } from '../entities/chat-message.entity';
import { Conversation } from '../entities/conversation.entity';

const TITULO_POR_DEFECTO = 'Nueva conversación';
const LARGO_TITULO = 60;

export interface ResumenConversacion {
  id: string;
  titulo: string;
  mensajes: number;
  /** Primeras palabras del último mensaje, para reconocerla en la lista. */
  ultimoMensaje: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Sesiones de chat de un libro: crear, listar, renombrar y borrar. */
@Injectable()
export class ConversacionesService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversaciones: Repository<Conversation>,
    @InjectRepository(ChatMessage)
    private readonly mensajes: Repository<ChatMessage>,
    private readonly documentos: DocumentsService,
  ) {}

  async listar(userId: string, documentId: string): Promise<ResumenConversacion[]> {
    await this.documentos.obtener(userId, documentId);

    const filas = await this.conversaciones
      .createQueryBuilder('c')
      .leftJoin('c.messages', 'm')
      .select('c.id', 'id')
      .addSelect('c.titulo', 'titulo')
      .addSelect('c.created_at', 'createdAt')
      .addSelect('c.updated_at', 'updatedAt')
      .addSelect('COUNT(m.id)', 'mensajes')
      .where('c.document_id = :documentId', { documentId })
      .andWhere('c.user_id = :userId', { userId })
      .groupBy('c.id')
      .orderBy('c.updated_at', 'DESC')
      .getRawMany<{ id: string; titulo: string; createdAt: Date; updatedAt: Date; mensajes: string }>();

    // Un mensaje por conversación: alcanza para la vista previa sin traer todo el historial.
    const ultimos = await Promise.all(
      filas.map((fila) =>
        this.mensajes.findOne({
          where: { conversationId: fila.id },
          order: { createdAt: 'DESC' },
          select: { id: true, content: true, role: true },
        }),
      ),
    );

    return filas.map((fila, i) => ({
      id: fila.id,
      titulo: fila.titulo,
      mensajes: Number(fila.mensajes),
      ultimoMensaje: ultimos[i] ? this.recortar(ultimos[i].content, 90) : null,
      createdAt: fila.createdAt,
      updatedAt: fila.updatedAt,
    }));
  }

  async crear(userId: string, documentId: string, titulo?: string): Promise<Conversation> {
    await this.documentos.obtener(userId, documentId);

    return this.conversaciones.save(
      this.conversaciones.create({
        userId,
        documentId,
        titulo: titulo?.trim() || TITULO_POR_DEFECTO,
      }),
    );
  }

  /** La conversación tiene que ser del usuario y del libro de la ruta. */
  async obtener(userId: string, documentId: string, id: string): Promise<Conversation> {
    const conversacion = await this.conversaciones.findOneBy({ id, userId, documentId });

    if (!conversacion) {
      throw new NotFoundException('Esa conversación no existe o ya se borró.');
    }

    return conversacion;
  }

  async renombrar(
    userId: string,
    documentId: string,
    id: string,
    titulo: string,
  ): Promise<Conversation> {
    const conversacion = await this.obtener(userId, documentId, id);
    conversacion.titulo = this.recortar(titulo.trim(), LARGO_TITULO) || TITULO_POR_DEFECTO;
    return this.conversaciones.save(conversacion);
  }

  async eliminar(userId: string, documentId: string, id: string): Promise<void> {
    await this.obtener(userId, documentId, id);
    await this.conversaciones.delete({ id });
  }

  async mensajesDe(userId: string, documentId: string, id: string): Promise<ChatMessage[]> {
    await this.obtener(userId, documentId, id);

    return this.mensajes.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Con la primera pregunta la conversación toma su nombre; después solo se
   * actualiza la fecha para que suba en la lista.
   */
  async registrarActividad(conversacion: Conversation, primerMensaje: string): Promise<void> {
    // La hora la pone la base de datos, como en el resto de columnas de fecha.
    const cambios: { updatedAt: () => string; titulo?: string } = { updatedAt: () => 'now()' };

    if (conversacion.titulo === TITULO_POR_DEFECTO) {
      const previos = await this.mensajes.count({
        where: { conversationId: conversacion.id, role: RolMensaje.User },
      });
      if (previos <= 1) cambios.titulo = this.tituloDesde(primerMensaje);
    }

    await this.conversaciones.update(conversacion.id, cambios);
  }

  private tituloDesde(mensaje: string): string {
    const limpio = mensaje.replace(/\s+/g, ' ').trim();
    const titulo = this.recortar(limpio, LARGO_TITULO);
    return titulo ? titulo[0].toUpperCase() + titulo.slice(1) : TITULO_POR_DEFECTO;
  }

  private recortar(texto: string, largo: number): string {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
  }
}
