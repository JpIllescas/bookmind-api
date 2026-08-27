import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/entities/document.entity';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
@Module({ imports: [TypeOrmModule.forFeature([Document])], controllers: [ProgressController], providers: [ProgressService] })
export class ProgressModule {}
