import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { CONSTANTS } from './common/configuration/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('BookMind');

  const trust = CONSTANTS.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust);

  app.use(helmet());

  app.use(
    ['/api/docs'],
    basicAuth({
      challenge: true,
      users: { [CONSTANTS.SWAGGER_USER]: CONSTANTS.SWAGGER_PASS },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('BookMind AI')
    .setDescription(
      'API de la plataforma de estudio conversacional sobre libros escolares.',
    )
    .addServer(CONSTANTS.API_URL)
    .addBearerAuth()
    .setVersion('1.0.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: CONSTANTS.FRONTEND_URL,
    methods: 'GET,HEAD,PATCH,POST,PUT,DELETE',
    credentials: true,
  });

  // Cierre ordenado: ante SIGTERM/SIGINT cierra conexiones de BD y crons.
  app.enableShutdownHooks();

  await app.listen(CONSTANTS.PORT);

  logger.log(`API en ${CONSTANTS.API_URL}`);
  logger.log(`Documentación en ${CONSTANTS.API_URL}/docs`);

  if (CONSTANTS.LLM_PROVIDER === 'mock') {
    logger.warn(
      'LLM_PROVIDER=mock: el chat devolverá respuestas simuladas. ' +
        'Configura gemini u ollama en .env cuando decidas el motor.',
    );
  }
}

void bootstrap();
