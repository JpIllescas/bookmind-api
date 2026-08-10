import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AuthUser } from '../interfaces/auth-user.interface';

/** Inyecta el usuario autenticado en un handler. */
export const CurrentUser = createParamDecorator(
  (_datos: unknown, contexto: ExecutionContext): AuthUser => {
    return contexto.switchToHttp().getRequest<{ user: AuthUser }>().user;
  },
);
