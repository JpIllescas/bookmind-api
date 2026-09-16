import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatModule } from '../chat/chat.module';
import { QuizAttempt } from '../content/entities/quiz-attempt.entity';
import { DocumentsModule } from '../documents/documents.module';
import { UsersModule } from '../users/users.module';
import { StudyPlan } from './entities/study-plan.entity';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';

@Module({
  // El motor conversacional y los prompts vienen de ChatModule, no se duplican aquí.
  imports: [
    TypeOrmModule.forFeature([StudyPlan, QuizAttempt]),
    DocumentsModule,
    UsersModule,
    ChatModule,
  ],
  controllers: [StudyController],
  providers: [StudyService],
  exports: [StudyService],
})
export class StudyModule {}
