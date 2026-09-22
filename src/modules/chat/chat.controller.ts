import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ChatService, EventoChat } from './chat.service';
import { CrearConversacionDto, RenombrarConversacionDto } from './dto/conversacion.dto';
import { EnviarMensajeDto } from './dto/enviar-mensaje.dto';
import { ConversacionesService } from './services/conversaciones.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly conversaciones: ConversacionesService,
  ) {}

  @Post()
  enviar(@CurrentUser() usuario: AuthUser, @Body() dto: EnviarMensajeDto) {
    return this.chat.responder(usuario.id, dto.documentId, dto.message, dto.conversationId);
  }

  /**
   * Server-Sent Events sobre POST: EventSource no manda el token JWT, así que
   * el frontend lo consume con fetch y lee el cuerpo por trozos.
   */
  @Post('stream')
  async enviarEnStream(
    @CurrentUser() usuario: AuthUser,
    @Body() dto: EnviarMensajeDto,
    @Req() peticion: Request,
    @Res() respuesta: Response,
  ) {
    respuesta.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    respuesta.setHeader('Cache-Control', 'no-cache, no-transform');
    respuesta.setHeader('Connection', 'keep-alive');
    respuesta.setHeader('X-Accel-Buffering', 'no');
    respuesta.flushHeaders();

    const control = new AbortController();
    peticion.on('close', () => control.abort());

    const emitir = (evento: EventoChat) => {
      if (respuesta.writableEnded) return;
      respuesta.write(`event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);
    };

    try {
      await this.chat.responderEnStream(
        usuario.id,
        dto.documentId,
        dto.message,
        emitir,
        control.signal,
        dto.conversationId,
      );
    } catch (error) {
      emitir({
        tipo: 'error',
        mensaje:
          error instanceof Error && error.message
            ? error.message
            : 'El asistente no pudo responder. Inténtalo otra vez.',
      });
    } finally {
      respuesta.end();
    }
  }

  @Get(':documentId/acciones')
  acciones(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.chat.accionesRapidas(usuario.id, documentId);
  }

  @Get(':documentId/sugerencias')
  sugerencias(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.chat.sugerencias(usuario.id, documentId);
  }

  // --- Conversaciones (sesiones de chat) ---

  @Get(':documentId/conversaciones')
  listarConversaciones(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.conversaciones.listar(usuario.id, documentId);
  }

  @Post(':documentId/conversaciones')
  crearConversacion(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: CrearConversacionDto,
  ) {
    return this.conversaciones.crear(usuario.id, documentId, dto.titulo);
  }

  @Get(':documentId/conversaciones/:id/mensajes')
  async mensajes(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const mensajes = await this.conversaciones.mensajesDe(usuario.id, documentId, id);

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

  @Patch(':documentId/conversaciones/:id')
  renombrar(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenombrarConversacionDto,
  ) {
    return this.conversaciones.renombrar(usuario.id, documentId, id, dto.titulo);
  }

  @Delete(':documentId/conversaciones/:id')
  @HttpCode(204)
  eliminar(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversaciones.eliminar(usuario.id, documentId, id);
  }
}
