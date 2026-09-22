import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { RegistrarLeccionDto } from './dto/registrar-leccion.dto';
import { GamificacionService } from './services/gamificacion.service';
import { LeccionesService } from './services/lecciones.service';
import { RutaService } from './services/ruta.service';

/** `desfase` es el de Date.getTimezoneOffset(): sin él el día terminaría a la hora UTC. */
function desfaseDe(valor?: string): number {
  const numero = Number(valor);
  return Number.isFinite(numero) && Math.abs(numero) <= 14 * 60 ? numero : 0;
}

@ApiTags('aprendizaje')
@ApiBearerAuth()
@Controller('aprendizaje')
@UseGuards(JwtAuthGuard)
export class AprendizajeController {
  constructor(
    private readonly gamificacion: GamificacionService,
    private readonly ruta: RutaService,
    private readonly lecciones: LeccionesService,
  ) {}

  @Get('resumen')
  resumen(@CurrentUser() usuario: AuthUser, @Query('desfase') desfase?: string) {
    return this.gamificacion.resumen(usuario.id, desfaseDe(desfase));
  }

  @Get('documentos/:id/ruta')
  rutaDe(@CurrentUser() usuario: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ruta.ruta(usuario.id, id);
  }

  @Get('documentos/:id/unidades/:chapterId/leccion')
  leccion(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    return this.lecciones.obtener(usuario.id, id, chapterId);
  }

  /** Otra tanda de ejercicios de la misma unidad. */
  @Post('documentos/:id/unidades/:chapterId/leccion/regenerar')
  regenerar(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
  ) {
    return this.lecciones.obtener(usuario.id, id, chapterId, true);
  }

  @Post('documentos/:id/unidades/:chapterId/intentos')
  registrar(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: RegistrarLeccionDto,
    @Query('desfase') desfase?: string,
  ) {
    return this.ruta.registrar(usuario.id, id, chapterId, dto, desfaseDe(desfase));
  }
}
