/** `request.user` tras pasar el JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Contenido del JWT que firma el backend. */
export interface JwtPayload {
  /** id del usuario */
  sub: string;
  email: string;
}
