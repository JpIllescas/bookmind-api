import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Algorithm } from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../../common/configuration/constants';
import {
  AuthUser,
  JwtPayload,
} from '../../../common/interfaces/auth-user.interface';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User)
    private readonly usuarios: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: CONSTANTS.JWT_SECRET,
      // Fijarlo impide el ataque "alg: none" y la confusión HS/RS.
      algorithms: [CONSTANTS.JWT_ALGORITHM as Algorithm],
    });
  }

  /** Consulta la base en cada petición: borrar un usuario corta sus tokens ya. */
  async validate(carga: JwtPayload): Promise<AuthUser> {
    const usuario = await this.usuarios.findOne({
      where: { id: carga.sub },
      select: { id: true, email: true, name: true, preferences: true },
    });

    if (!usuario) {
      throw new UnauthorizedException('La sesión ya no es válida.');
    }

    return {
      id: usuario.id,
      email: usuario.email,
      name: usuario.name,
      preferenceCompleted: usuario.preferences != null,
    };
  }
}
