import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ChatService } from './chat.service';
import { EnviarMensajeDto } from './dto/enviar-mensaje.dto';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  enviar(@CurrentUser() usuario: AuthUser, @Body() dto: EnviarMensajeDto) {
    return this.chat.responder(usuario.id, dto.documentId, dto.message);
  }

  @Get(':documentId')
  historial(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.chat.historial(usuario.id, documentId);
  }

  @Get(':documentId/acciones')
  acciones(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.chat.accionesRapidas(usuario.id, documentId);
  }
}
