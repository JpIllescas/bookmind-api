import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { dataSourceOptions } from './common/configuration/typeorm.config';
import { AnclajeModule } from './modules/anclaje/anclaje.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { MlModule } from './modules/ml/ml.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRoot(dataSourceOptions),

    // Importa sobre todo en /auth/login: probar contraseñas sale gratis.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    UsersModule,
    AuthModule,
    MlModule,
    AnclajeModule,
    DocumentsModule,
    ChatModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
