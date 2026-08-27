import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { DocumentsModule } from '../documents/documents.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { UsersModule } from '../users/users.module';
import { GeneratedContent } from './entities/generated-content.entity';
@Module({ imports: [TypeOrmModule.forFeature([GeneratedContent]), DocumentsModule, ChatModule, UsersModule], controllers: [ContentController], providers: [ContentService] })
export class ContentModule {}
