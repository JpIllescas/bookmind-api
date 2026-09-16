import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { DocumentsModule } from '../documents/documents.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { UsersModule } from '../users/users.module';
import { GeneratedContent } from './entities/generated-content.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
@Module({ imports: [TypeOrmModule.forFeature([GeneratedContent, QuizAttempt]), DocumentsModule, ChatModule, UsersModule], controllers: [ContentController], providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
