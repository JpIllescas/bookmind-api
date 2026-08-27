import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GuardarPreferenciasDto } from './dto/guardar-preferencias.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly usuarios: Repository<User>) {}

  async obtenerPreferencias(userId: string) {
    const usuario = await this.usuarios.findOne({
      where: { id: userId },
      select: { id: true, preferences: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    return usuario.preferences;
  }

  async guardarPreferencias(userId: string, dto: GuardarPreferenciasDto) {
    const usuario = await this.usuarios.findOne({ where: { id: userId } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    usuario.preferences = dto;
    await this.usuarios.save(usuario);
    return dto;
  }
}
