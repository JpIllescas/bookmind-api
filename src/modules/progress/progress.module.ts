import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatMessage } from '../chat/entities/chat-message.entity';
import { QuizAttempt } from '../content/entities/quiz-attempt.entity';
import { Document } from '../documents/entities/document.entity';
import { DocumentsModule } from '../documents/documents.module';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, QuizAttempt, ChatMessage]), DocumentsModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
