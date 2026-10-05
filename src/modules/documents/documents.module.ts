import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { memoryStorage } from 'multer';

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

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentChunk, Chapter]),
    MlModule,
    AnclajeModule,

    // Aquí y no en el controlador: el decorador se evalúa antes del .env.
    MulterModule.register({
      // El archivo no se persiste localmente: se envía a Neon Object Storage.
      storage: memoryStorage(),
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
