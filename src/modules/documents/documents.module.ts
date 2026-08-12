import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { AnclajeModule } from '../anclaje/anclaje.module';
import { MlModule } from '../ml/ml.module';
import { DocumentChunk } from './entities/document-chunk.entity';
import { Document } from './entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ExtraccionService } from './services/extraccion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentChunk]),
    MlModule,
    AnclajeModule,

    // Aquí y no en el controlador: el decorador se evalúa antes del .env.
    MulterModule.register({
      // En memoria: el libro nunca queda como archivo suelto en el servidor.
      limits: {
        fileSize: CONSTANTS.MAX_FILE_SIZE_MB * 1024 * 1024,
        files: 1,
      },
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ExtraccionService],
  exports: [DocumentsService, ExtraccionService],
})
export class DocumentsModule {}
