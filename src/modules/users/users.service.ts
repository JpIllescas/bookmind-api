import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { ProveedorLlm } from '../../common/enums/llm-provider.enum';
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

  /** `disponible` es del servidor (LLM_PROVIDER); `activada`, la elección del estudiante. */
  async ayudaGemini(userId: string): Promise<{ activada: boolean; disponible: boolean }> {
    const usuario = await this.usuarios.findOne({
      where: { id: userId },
      select: { id: true, usarGemini: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado.');
    return { activada: usuario.usarGemini, disponible: CONSTANTS.LLM_PROVIDER === ProveedorLlm.Gemini };
  }

  async guardarAyudaGemini(userId: string, activada: boolean) {
    await this.usuarios.update({ id: userId }, { usarGemini: activada });
    return this.ayudaGemini(userId);
  }

  async completarOnboarding(userId: string): Promise<{ completado: true }> {
    const resultado = await this.usuarios.update({ id: userId }, { onboardingCompletado: true });
    if (!resultado.affected) throw new NotFoundException('Usuario no encontrado.');
    return { completado: true };
  }

  /** Gemini solo entra si el servidor lo tiene y el estudiante no lo apagó. */
  async usaGemini(userId: string): Promise<boolean> {
    const { activada, disponible } = await this.ayudaGemini(userId);
    return activada && disponible;
  }
}
