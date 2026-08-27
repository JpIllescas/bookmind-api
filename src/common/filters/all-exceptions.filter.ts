import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';


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

    // Código de error del driver de Postgres o de Multer, si el error lo trae.
    const code = (exception as { code?: string } | null)?.code;

    // 23505: violación de índice único. Hoy el único es el correo.
    if (code === '23505') {
      status = HttpStatus.CONFLICT;
    }

    // Archivo más grande que el límite de Multer.
    if (code === 'LIMIT_FILE_SIZE') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
    }

    // Los 4xx son entrada del cliente y no ensucian el log.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // Nunca se devuelven rutas, stacks, SQL ni mensajes del driver al cliente.
    // El detalle queda únicamente en los logs internos del backend.
    response.status(status).json({
      statusCode: status,
      message: this.mensajePublico(status),
    });
  }

  private mensajePublico(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'La solicitud no es válida.';
      case HttpStatus.UNAUTHORIZED:
        return 'No se pudo autenticar la solicitud.';
      case HttpStatus.FORBIDDEN:
        return 'No tienes permiso para realizar esta acción.';
      case HttpStatus.NOT_FOUND:
        return 'No se encontró el recurso solicitado.';
      case HttpStatus.CONFLICT:
        return 'No se pudo completar la operación.';
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return 'El archivo o la solicitud excede el límite permitido.';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'Demasiadas solicitudes. Intenta más tarde.';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'El servicio no está disponible en este momento.';
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? 'Ocurrió un error interno. Intenta más tarde.'
          : 'No se pudo completar la solicitud.';
    }
  }
}
