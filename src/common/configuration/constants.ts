import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { join } from 'path';

import { ProveedorLlm } from '../enums/llm-provider.enum';

// El backend tiene su propio .env; mantener el fallback permite ejecutar desde su raíz.
config({ path: join(__dirname, '..', '..', '..', '.env') });
config({ path: join(process.cwd(), '.env') });

const configService = new ConfigService();

/** Valida el motor conversacional al arrancar, no en la primera petición. */
function validarProveedorLlm(valor: string | undefined): ProveedorLlm {
  const proveedor = (valor ?? ProveedorLlm.Mock) as ProveedorLlm;
  const validos = Object.values(ProveedorLlm);

  if (!validos.includes(proveedor)) {
    throw new Error(
      `LLM_PROVIDER="${valor}" no es válido. Usa uno de: ${validos.join(', ')}.`,
    );
  }

  if (
    proveedor === ProveedorLlm.Gemini &&
    !configService.get('GEMINI_API_KEY')
  ) {
    throw new Error(
      'LLM_PROVIDER=gemini pero GEMINI_API_KEY está vacía. Consíguela en ' +
        'https://aistudio.google.com/apikey, o usa LLM_PROVIDER=mock mientras tanto.',
    );
  }

  return proveedor;
}

export const CONSTANTS = {
  // Entorno
  ENV: configService.getOrThrow<string>('ENV'),
  PORT: Number(configService.getOrThrow('PORT')),
  API_URL: configService.getOrThrow<string>('API_URL'),

  // Swagger
  SWAGGER_USER: configService.getOrThrow<string>('SWAGGER_USER'),
  SWAGGER_PASS: configService.getOrThrow<string>('SWAGGER_PASS'),

  // JWT
  JWT_SECRET: configService.getOrThrow<string>('JWT_SECRET'),
  JWT_ALGORITHM: configService.getOrThrow<string>('JWT_ALGORITHM'),
  JWT_EXPIRE: configService.getOrThrow<string>('JWT_EXPIRE'),

  // OAuth de Google. Vacío deshabilita el endpoint hasta configurarlo.
  GOOGLE_CLIENT_ID: configService.get<string>('GOOGLE_CLIENT_ID') ?? '',
  GOOGLE_SECRET_ID: configService.get<string>('GOOGLE_SECRET_ID') ?? '',
  GOOGLE_REDIRECT_URI:
    configService.get<string>('GOOGLE_REDIRECT_URI') ??
    'http://localhost:3000/api/auth/google/callback',

  // Base de datos
  DB_HOST: configService.getOrThrow<string>('DB_HOST'),
  DB_PORT: Number(configService.getOrThrow('DB_PORT')),
  DB_USERNAME: configService.getOrThrow<string>('DB_USERNAME'),
  DB_PASSWORD: configService.getOrThrow<string>('DB_PASSWORD'),
  DB_NAME: configService.getOrThrow<string>('DB_NAME'),
  DB_SCHEMA: configService.getOrThrow<string>('DB_SCHEMA'),

  // Motor conversacional (pieza 1)
  LLM_PROVIDER: validarProveedorLlm(configService.get<string>('LLM_PROVIDER')),
  GEMINI_API_KEY: configService.get<string>('GEMINI_API_KEY') ?? '',
  GEMINI_MODEL: configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash',
  GEMINI_CONTEXT_CACHING:
    (configService.get<string>('GEMINI_CONTEXT_CACHING') ?? 'false') === 'true',
  OLLAMA_BASE_URL:
    configService.get<string>('OLLAMA_BASE_URL') ?? 'http://localhost:11434',
  OLLAMA_MODEL: configService.get<string>('OLLAMA_MODEL') ?? 'llama3.1:8b',
  OLLAMA_USE_RETRIEVAL:
    (configService.get<string>('OLLAMA_USE_RETRIEVAL') ?? 'true') === 'true',

  // Verificador de anclaje (pieza 2)
  EMBEDDING_MODEL:
    configService.get<string>('EMBEDDING_MODEL') ??
    'Xenova/multilingual-e5-small',
  GROUNDING_THRESHOLD: Number(
    configService.get<string>('GROUNDING_THRESHOLD') ?? '0.72',
  ),

  // Clasificador (pieza 3)
  ML_SERVICE_URL:
    configService.get<string>('ML_SERVICE_URL') ?? 'http://localhost:8000',

  // Archivos
  UPLOAD_PATH: configService.get<string>('UPLOAD_PATH') ?? './uploads',
  MAX_FILE_SIZE_MB: Number(configService.getOrThrow('MAX_FILE_SIZE_MB')),

  // Frontend (CORS)
  FRONTEND_URL: configService.getOrThrow<string>('FRONTEND_URL'),

  TRUST_PROXY: configService.get<string>('TRUST_PROXY') ?? '1',
};
