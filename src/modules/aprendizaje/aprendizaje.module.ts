import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChatMessage } from '../chat/entities/chat-message.entity';
import { QuizAttempt } from '../content/entities/quiz-attempt.entity';
import { DocumentsModule } from '../documents/documents.module';
import { MlModule } from '../ml/ml.module';
import { UsersModule } from '../users/users.module';
import { AprendizajeController } from './aprendizaje.controller';
import { Lesson } from './entities/lesson.entity';
import { LessonAttempt } from './entities/lesson-attempt.entity';
import { EjerciciosService } from './services/ejercicios.service';
import { GamificacionService } from './services/gamificacion.service';
import { LeccionesService } from './services/lecciones.service';
import { RutaService } from './services/ruta.service';

/** Ruta de aprendizaje tipo Duolingo: lecciones por unidad, coronas, XP y racha. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Lesson, LessonAttempt, QuizAttempt, ChatMessage]),
    DocumentsModule,
    MlModule,
    UsersModule,
  ],
  controllers: [AprendizajeController],
  providers: [EjerciciosService, LeccionesService, RutaService, GamificacionService],
  exports: [GamificacionService],
})
export class AprendizajeModule {}
