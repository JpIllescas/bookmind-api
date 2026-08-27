import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { JwtPayload } from '../../common/interfaces/auth-user.interface';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegistrarDto } from './dto/registrar.dto';
/** 12 rondas ~250 ms: caro para fuerza bruta, imperceptible en un login. */
const RONDAS_BCRYPT = 12;

export interface RespuestaAuth {
  token: string;
  user: { id: string; email: string; name: string };
}

@Injectable()
export class AuthService {
  /** Hash bcrypt real usado como señuelo, calculado al primer uso. */
  private hashSenuelo?: string;

  constructor(
    @InjectRepository(User) private readonly usuarios: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  obtenerUrlGoogle(): string {
    if (!CONSTANTS.GOOGLE_CLIENT_ID || !CONSTANTS.GOOGLE_SECRET_ID) {
      throw new UnauthorizedException('El registro con Google no está configurado.');
    }

    const cliente = new OAuth2Client(
      CONSTANTS.GOOGLE_CLIENT_ID,
      CONSTANTS.GOOGLE_SECRET_ID,
      CONSTANTS.GOOGLE_REDIRECT_URI,
    );
    const state = this.jwt.sign({ purpose: 'google-oauth' }, { expiresIn: '10m' });
    return cliente.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    });
  }

  async callbackGoogle(code?: string, state?: string): Promise<string> {
    const destino = `${CONSTANTS.FRONTEND_URL}/entrar`;
    if (!code || !state) return `${destino}?google_error=missing_code`;

    try {
      const estado = this.jwt.verify<{ purpose?: string }>(state);
      if (estado.purpose !== 'google-oauth') throw new Error('Estado inválido');

      const cliente = new OAuth2Client(
        CONSTANTS.GOOGLE_CLIENT_ID,
        CONSTANTS.GOOGLE_SECRET_ID,
        CONSTANTS.GOOGLE_REDIRECT_URI,
      );
      const { tokens } = await cliente.getToken(code);
      if (!tokens.id_token) throw new Error('Google no devolvió un id_token');

      const sesion = await this.registrarConGoogle(tokens.id_token);
      return `${destino}#google_token=${encodeURIComponent(sesion.token)}`;
    } catch {
      return `${destino}?google_error=invalid_callback`;
    }
  }

  async registrar(dto: RegistrarDto): Promise<RespuestaAuth> {
    const email = this.normalizarEmail(dto.email);

    if (await this.usuarios.existsBy({ email })) {
      throw new ConflictException('Ya existe una cuenta con este correo.');
    }

    const usuario = this.usuarios.create({
      email,
      name: dto.name.trim(),
      passwordHash: await bcrypt.hash(dto.password, RONDAS_BCRYPT),
    });

    await this.usuarios.save(usuario);

    return this.construirRespuesta(usuario);
  }

  async login(dto: LoginDto): Promise<RespuestaAuth> {
    const email = this.normalizarEmail(dto.email);

    // `passwordHash` tiene `select: false`: hay que pedirlo explícitamente.
    const usuario = await this.usuarios.findOne({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Con un señuelo, un correo registrado y uno que no tardan lo mismo.
    const hash = usuario?.passwordHash ?? this.obtenerHashSenuelo();
    const coincide = await bcrypt.compare(dto.password, hash);

    if (!usuario || !coincide) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    return this.construirRespuesta(usuario);
  }

  async registrarConGoogle(idToken: string): Promise<RespuestaAuth> {
    if (!CONSTANTS.GOOGLE_CLIENT_ID) {
      throw new UnauthorizedException(
        'El registro con Google no está configurado.',
      );
    }

    let payload;
    try {
      const cliente = new OAuth2Client(CONSTANTS.GOOGLE_CLIENT_ID);
      const ticket = await cliente.verifyIdToken({
        idToken,
        audience: CONSTANTS.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('El token de Google no es válido.');
    }

    if (
      !payload ||
      payload.iss !== 'https://accounts.google.com' ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string'
    ) {
      throw new UnauthorizedException(
        'La cuenta de Google no tiene un correo verificado.',
      );
    }

    const email = this.normalizarEmail(payload.email);
    const existente = await this.usuarios.findOne({ where: { email } });
    if (existente) {
      return this.construirRespuesta(existente);
    }

    const name =
      typeof payload.name === 'string' && payload.name.trim().length > 0
        ? payload.name.trim().slice(0, 80)
        : email.split('@')[0];
    const usuario = this.usuarios.create({ email, name, passwordHash: null });

    await this.usuarios.save(usuario);
    return this.construirRespuesta(usuario);
  }

  private construirRespuesta(usuario: User): RespuestaAuth {
    const carga: JwtPayload = { sub: usuario.id, email: usuario.email };

    return {
      token: this.jwt.sign(carga),
      user: { id: usuario.id, email: usuario.email, name: usuario.name },
    };
  }

  private obtenerHashSenuelo(): string {
    this.hashSenuelo ??= bcrypt.hashSync(
      'contrasena-que-nadie-va-a-usar-jamas',
      RONDAS_BCRYPT,
    );
    return this.hashSenuelo;
  }

  private normalizarEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
