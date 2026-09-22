import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnclajeModule } from '../anclaje/anclaje.module';
import { ChatModule } from '../chat/chat.module';
import { DocumentsModule } from '../documents/documents.module';
import { MlModule } from '../ml/ml.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { ResumenService } from './services/resumen.service';
import { UsersModule } from '../users/users.module';
import { GeneratedContent } from './entities/generated-content.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';
@Module({ imports: [TypeOrmModule.forFeature([GeneratedContent, QuizAttempt]), DocumentsModule, ChatModule, AnclajeModule, MlModule, UsersModule], controllers: [ContentController], providers: [ContentService, ResumenService], exports: [ContentService] })
export class ContentModule {}
