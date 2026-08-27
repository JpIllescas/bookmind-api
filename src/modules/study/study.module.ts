import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudyPlan } from './entities/study-plan.entity';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';
import { DocumentsModule } from '../documents/documents.module';
import { UsersModule } from '../users/users.module';
import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import { GeminiProvider } from '../chat/providers/gemini.provider';
import { MockProvider } from '../chat/providers/mock.provider';
import { CONSTANTS } from '../../common/configuration/constants';
import { ProveedorLlm } from '../../common/enums/llm-provider.enum';

const proveedor = {
  provide: LLM_PROVIDER,
  useFactory: () => CONSTANTS.LLM_PROVIDER === ProveedorLlm.Gemini
    ? new GeminiProvider()
    : new MockProvider(),
};

@Module({ imports: [TypeOrmModule.forFeature([StudyPlan]), DocumentsModule, UsersModule], controllers: [StudyController], providers: [StudyService, proveedor], exports: [StudyService] })
export class StudyModule {}
