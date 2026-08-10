import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Exige un JWT válido. El filtrado por userId lo hace cada servicio. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
