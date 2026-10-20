import { Logger, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { ProveedorLlm } from '../../common/enums/llm-provider.enum';
import { AnclajeModule } from '../anclaje/anclaje.module';
import { DocumentsModule } from '../documents/documents.module';
import { UsersModule } from '../users/users.module';
import { AsistenteController } from './asistente.controller';
import { ChatController } from './chat.controller';
import { CompartirController } from './compartir.controller';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';
import { LlamadaLlm } from './entities/llamada-llm.entity';
import { GeminiProvider } from './providers/gemini.provider';
import { LLM_PROVIDER, LlmProvider } from './providers/llm-provider.interface';
import { SinModeloProvider } from './providers/sin-modelo.provider';
import { ContextoService } from './services/contexto.service';
import { ConversacionesService } from './services/conversaciones.service';
import { IntencionService } from './services/intencion.service';
import { MetricasLlmService } from './services/metricas-llm.service';
import { PromptService } from './services/prompt.service';
import { RespuestaExtractivaService } from './services/respuesta-extractiva.service';
import { ElevenLabsService } from './services/elevenlabs.service';

const proveedorLlm: Provider = {
  provide: LLM_PROVIDER,
  inject: [MetricasLlmService],
  useFactory: (metricas: MetricasLlmService): LlmProvider => {
    const logger = new Logger('LlmProvider');

    switch (CONSTANTS.LLM_PROVIDER) {
      case ProveedorLlm.Gemini:
        logger.log(`Motor conversacional: ${CONSTANTS.GEMINI_MODEL}`);
        return new GeminiProvider(metricas);

      case ProveedorLlm.Ollama:
        throw new Error(
          'LLM_PROVIDER=ollama todavía no está implementado. Usa gemini o mock.',
        );

      default:
        logger.warn('Sin modelo de lenguaje (LLM_PROVIDER=mock): todo sale del motor propio.');
        return new SinModeloProvider();
    }
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, Conversation, LlamadaLlm]),
    DocumentsModule,
    AnclajeModule,
    UsersModule,
  ],
  controllers: [ChatController, AsistenteController, CompartirController],
  providers: [
    ChatService,
    ConversacionesService,
    PromptService,
    ContextoService,
    IntencionService,
    MetricasLlmService,
    proveedorLlm,
    ElevenLabsService,
    RespuestaExtractivaService,
  ],
  exports: [LLM_PROVIDER, PromptService, ContextoService],
})
export class ChatModule {}
