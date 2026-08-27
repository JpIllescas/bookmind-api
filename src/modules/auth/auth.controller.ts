import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegistrarDto } from './dto/registrar.dto';
import { GoogleRegisterDto } from './dto/google-register.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
// `import type` es obligatorio en firmas decoradas con isolatedModules.
import type { AuthUser } from '../../common/interfaces/auth-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('google')
  iniciarGoogle(@Res() respuesta: Response) {
    return respuesta.redirect(this.auth.obtenerUrlGoogle());
  }

  @Get('google/callback')
  async callbackGoogle(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() respuesta: Response,
  ) {
    const url = await this.auth.callbackGoogle(code, state);
    return respuesta.redirect(url);
  }

  @Post('register')
  registrar(@Body() dto: RegistrarDto) {
    return this.auth.registrar(dto);
  }

  @Post('google')
  @HttpCode(200)
  registrarConGoogle(@Body() dto: GoogleRegisterDto) {
    return this.auth.registrarConGoogle(dto.idToken);
  }

  @Post('login')
  // Un login no crea un recurso: 200, no el 201 por defecto.
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Permite al frontend saber si el token guardado sigue siendo válido. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  yo(@CurrentUser() usuario: AuthUser) {
    return usuario;
  }
}
