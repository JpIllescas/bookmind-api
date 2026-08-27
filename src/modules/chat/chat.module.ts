import { Logger, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { ProveedorLlm } from '../../common/enums/llm-provider.enum';
import { AnclajeModule } from '../anclaje/anclaje.module';
import { DocumentsModule } from '../documents/documents.module';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatMessage } from './entities/chat-message.entity';
import { GeminiProvider } from './providers/gemini.provider';
import { LLM_PROVIDER, LlmProvider } from './providers/llm-provider.interface';
import { MockProvider } from './providers/mock.provider';
import { PromptService } from './services/prompt.service';

const proveedorLlm: Provider = {
  provide: LLM_PROVIDER,
  useFactory: (): LlmProvider => {
    const logger = new Logger('LlmProvider');

    switch (CONSTANTS.LLM_PROVIDER) {
      case ProveedorLlm.Gemini:
        logger.log(`Motor conversacional: ${CONSTANTS.GEMINI_MODEL}`);
        return new GeminiProvider();

      case ProveedorLlm.Ollama:
        throw new Error(
          'LLM_PROVIDER=ollama todavía no está implementado. Usa gemini o mock.',
        );

      default:
        logger.warn('Motor conversacional: mock (respuestas simuladas).');
        return new MockProvider();
    }
  },
};

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage]),
    DocumentsModule,
    AnclajeModule,
    UsersModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, PromptService, proveedorLlm],
  exports: [LLM_PROVIDER],
})
export class ChatModule {}
