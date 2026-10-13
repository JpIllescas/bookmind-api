import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { GuardarAyudaGeminiDto } from './dto/guardar-ayuda-gemini.dto';
import { GuardarPreferenciasDto } from './dto/guardar-preferencias.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('preferences')
  obtener(@CurrentUser() usuario: AuthUser) {
    return this.users.obtenerPreferencias(usuario.id);
  }

  @Put('preferences')
  guardar(@CurrentUser() usuario: AuthUser, @Body() dto: GuardarPreferenciasDto) {
    return this.users.guardarPreferencias(usuario.id, dto);
  }

  @Get('ayuda-gemini')
  ayudaGemini(@CurrentUser() usuario: AuthUser) {
    return this.users.ayudaGemini(usuario.id);
  }

  @Put('ayuda-gemini')
  guardarAyudaGemini(@CurrentUser() usuario: AuthUser, @Body() dto: GuardarAyudaGeminiDto) {
    return this.users.guardarAyudaGemini(usuario.id, dto.activada);
  }
}
