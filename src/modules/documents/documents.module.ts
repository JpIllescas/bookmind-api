import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { CONSTANTS } from '../../common/configuration/constants';
import { AnclajeModule } from '../anclaje/anclaje.module';
import { MlModule } from '../ml/ml.module';
import { Chapter } from './entities/chapter.entity';
import { DocumentChunk } from './entities/document-chunk.entity';
import { Document } from './entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { AlmacenamientoService } from './services/almacenamiento.service';
import { CapitulosService } from './services/capitulos.service';
import { ExtraccionService } from './services/extraccion.service';

const CARPETA_TEMPORAL = join(resolve(CONSTANTS.UPLOAD_PATH), 'tmp');

// Multer escribe antes de que arranque la app; la carpeta tiene que existir ya.
mkdirSync(CARPETA_TEMPORAL, { recursive: true });

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentChunk, Chapter]),
    MlModule,
    AnclajeModule,

    // Aquí y no en el controlador: el decorador se evalúa antes del .env.
    MulterModule.register({
      // A disco y no en memoria: un libro de 80 MB no se queda en la RAM del proceso.
      storage: diskStorage({
        destination: CARPETA_TEMPORAL,
        filename: (_peticion, _archivo, siguiente) =>
          siguiente(null, `${randomUUID()}.subida`),
      }),
      limits: {
        fileSize: CONSTANTS.MAX_FILE_SIZE_MB * 1024 * 1024,
        files: 1,
      },
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ExtraccionService, AlmacenamientoService, CapitulosService],
  exports: [DocumentsService, ExtraccionService, AlmacenamientoService, CapitulosService],
})
export class DocumentsModule {}
