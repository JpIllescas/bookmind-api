import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DocumentChunk } from '../documents/entities/document-chunk.entity';
import { AnclajeService } from './anclaje.service';
import { EmbeddingsService } from './services/embeddings.service';
import { FragmentacionService } from './services/fragmentacion.service';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentChunk])],
  providers: [AnclajeService, EmbeddingsService, FragmentacionService],
  exports: [AnclajeService, EmbeddingsService],
})
export class AnclajeModule {}
