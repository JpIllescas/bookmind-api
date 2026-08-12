import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

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

