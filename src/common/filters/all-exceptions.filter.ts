import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CONSTANTS } from '../configuration/constants';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Error interno del servidor';

    // Código de error del driver de Postgres o de Multer, si el error lo trae.
    const code = (exception as { code?: string } | null)?.code;

    // 23505: violación de índice único. Hoy el único es el correo.
    if (code === '23505') {
      status = HttpStatus.CONFLICT;
      message = {
        message: 'Ya existe una cuenta con este correo.',
        error: 'Conflict',
      };
    }

    // Archivo más grande que el límite de Multer.
    if (code === 'LIMIT_FILE_SIZE') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      message = {
        message:
          `El archivo excede el tamaño máximo permitido ` +
          `(${CONSTANTS.MAX_FILE_SIZE_MB} MB).`,
        error: 'Payload Too Large',
      };
    }

    // Los 4xx son entrada del cliente y no ensucian el log.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message:
        typeof message === 'string'
          ? message
          : ((message as { message?: string }).message ?? message),
    });
  }
}
