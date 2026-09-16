import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { GenerateContentDto } from './dto/generate-content.dto';
import { RegistrarIntentoDto } from './dto/registrar-intento.dto';
import { ContentService } from './content.service';

@Controller('documents/:documentId/content')
@UseGuards(JwtAuthGuard)
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  listar(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.content.listar(usuario.id, documentId);
  }

  @Post()
  generar(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: GenerateContentDto,
  ) {
    return this.content.generar(usuario.id, documentId, dto.type);
  }

  @Get('intentos')
  intentos(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.content.intentos_de(usuario.id, documentId);
  }

  @Post(':id/intentos')
  registrarIntento(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarIntentoDto,
  ) {
    return this.content.registrarIntento(usuario.id, documentId, id, dto);
  }

  @Delete(':id')
  eliminar(
    @CurrentUser() usuario: AuthUser,
    @Param('documentId', ParseUUIDPipe) _documentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.content.eliminar(usuario.id, id);
  }
}
