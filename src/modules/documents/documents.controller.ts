import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CONSTANTS } from '../../common/configuration/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { TipoDocumento } from '../../common/enums/tipo-documento.enum';
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

    const documento = await this.documentos.encolar(usuario.id, archivo);

    return this.documentos.comoResumen(documento);
  }

  @Get()
  listar(@CurrentUser() usuario: AuthUser) {
    return this.documentos.listar(usuario.id);
  }

  /** Sirve el archivo original; con Range el visor pide solo las páginas que muestra. */
  @Get(':id/file')
  // Un libro grande son decenas de peticiones por rango: el límite global lo cortaría.
  @SkipThrottle()
  @Header('Accept-Ranges', 'bytes')
  // helmet marca las respuestas como same-origin y el visor corre en otro puerto.
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  async archivo(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('range') rango: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const archivo = await this.documentos.abrirArchivo(usuario.id, id, rango);

    respuesta.setHeader('Content-Type', archivo.mime);
    respuesta.setHeader('Content-Length', archivo.fin - archivo.inicio + 1);

    if (archivo.esParcial) {
      respuesta.status(206);
      respuesta.setHeader(
        'Content-Range',
        `bytes ${archivo.inicio}-${archivo.fin}/${archivo.tamano}`,
      );
    }

    return new StreamableFile(archivo.flujo);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentos.eliminar(usuario.id, id);
  }

  @Get(':id')
  async detalle(
    @CurrentUser() usuario: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const documento = await this.documentos.obtener(usuario.id, id);

    // El PDF se lee del archivo original; solo el EPUB sigue mostrándose como texto.
    const extractedText =
      documento.type === TipoDocumento.EPUB
        ? await this.documentos.textoParaLectura(usuario.id, id)
        : null;

    return { ...this.documentos.comoResumen(documento), extractedText };
  }
}
