import { Controller, Get, Param } from '@nestjs/common';

import { ConversacionesService } from './services/conversaciones.service';

/** Endpoint público: el token largo es la autorización y solo permite lectura. */
@Controller('shared')
export class CompartirController {
  constructor(private readonly conversaciones: ConversacionesService) {}

  @Get(':token')
  obtener(@Param('token') token: string) {
    return this.conversaciones.publica(token);
  }
}
