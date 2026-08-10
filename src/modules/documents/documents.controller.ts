import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CONSTANTS } from '../../common/configuration/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { DocumentsService } from './documents.service';

@Controller('documents')
// El aislamiento por usuario lo cierra el servicio, filtrando por userId.
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentos: DocumentsService) {}

  @Post()
  // Los límites se configuran en DocumentsModule, no aquí.
  @UseInterceptors(FileInterceptor('file'))
  async subir(
    @CurrentUser() usuario: AuthUser,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    if (!archivo) {
      const maximo = CONSTANTS.MAX_FILE_SIZE_MB;
      throw new BadRequestException(
        `No se recibió ningún archivo. Envía un PDF o EPUB de hasta ${maximo} MB ` +
          'en el campo "file".',
      );
    }

    const documento = await this.documentos.subir(usuario.id, archivo);

    return this.documentos.comoResumen(documento);
  }

  @Get()
  listar(@CurrentUser() usuario: AuthUser) {
    return this.documentos.listar(usuario.id);
  }

  @Get(':id')
  async detalle(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const documento = await this.documentos.obtenerConTexto(usuario.id, id);

    return {
      ...this.documentos.comoResumen(documento),
      extractedText: documento.extractedText,
    };
  }
}
