import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';

/** Tipo inferido: las firmas sobrecargadas de TypeORM no encajan con jest.fn(). */
function crearRepositorioFalso() {
  return {
    existsBy: jest.fn<Promise<boolean>, [unknown]>(),
    findOne: jest.fn<Promise<User | null>, [unknown]>(),
    create: jest.fn((datos: Partial<User>) => datos as User),
    save: jest.fn(async (usuario: Partial<User>) => ({ id: 'id-1', ...usuario }) as User),
  };
}

describe('AuthService', () => {
  let servicio: AuthService;
  let usuarios: ReturnType<typeof crearRepositorioFalso>;

  beforeEach(async () => {
    usuarios = crearRepositorioFalso();

    const modulo = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: usuarios },
        { provide: JwtService, useValue: { sign: () => 'token-de-prueba' } },
      ],
    }).compile();

    servicio = modulo.get(AuthService);
  });

  describe('registrar', () => {
    it('normaliza el correo antes de guardarlo', async () => {
      usuarios.existsBy.mockResolvedValue(false);

      await servicio.registrar({
        email: '  Jose.Pablo@Ejemplo.COM ',
        password: 'contrasena123',
        name: '  José  ',
      });

      // Sin normalizar, "A@x.com" y "a@x.com" serían cuentas distintas y el
      // índice único no lo impediría.
      expect(usuarios.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'jose.pablo@ejemplo.com', name: 'José' }),
      );
    });

    it('nunca guarda la contraseña en claro', async () => {
      usuarios.existsBy.mockResolvedValue(false);

      await servicio.registrar({
        email: 'a@b.com',
        password: 'contrasena123',
        name: 'Ana',
      });

      const guardado = (usuarios.create as jest.Mock).mock.calls[0][0];
      expect(guardado.passwordHash).not.toBe('contrasena123');
      expect(await bcrypt.compare('contrasena123', guardado.passwordHash)).toBe(true);
    });

    it('rechaza un correo ya registrado', async () => {
      usuarios.existsBy.mockResolvedValue(true);

      await expect(
        servicio.registrar({ email: 'a@b.com', password: 'x'.repeat(10), name: 'Ana' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rechaza una contraseña incorrecta', async () => {
      usuarios.findOne.mockResolvedValue({
        id: 'id-1',
        email: 'a@b.com',
        name: 'Ana',
        passwordHash: await bcrypt.hash('la-correcta', 12),
      } as User);

      await expect(
        servicio.login({ email: 'a@b.com', password: 'la-incorrecta' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('devuelve el mismo error exista o no el correo', async () => {
      // Si los mensajes difirieran, cualquiera podría averiguar qué correos
      // tienen cuenta simplemente probando.
      usuarios.findOne.mockResolvedValue(null);
      const inexistente = await servicio
        .login({ email: 'nadie@b.com', password: 'x' })
        .catch((e: Error) => e.message);

      usuarios.findOne.mockResolvedValue({
        id: 'id-1',
        email: 'a@b.com',
        name: 'Ana',
        passwordHash: await bcrypt.hash('la-correcta', 12),
      } as User);
      const malaContrasena = await servicio
        .login({ email: 'a@b.com', password: 'x' })
        .catch((e: Error) => e.message);

      expect(inexistente).toBe(malaContrasena);
    });

    it('compara contra un hash señuelo cuando el correo no existe', async () => {
      // El login de un correo inexistente debe costar lo mismo que uno real.
      // Sin el señuelo retornaría de inmediato y la diferencia de tiempo
      // delataría qué correos están registrados.
      usuarios.findOne.mockResolvedValue(null);

      const inicio = Date.now();
      await servicio.login({ email: 'nadie@b.com', password: 'x' }).catch(() => undefined);
      const transcurrido = Date.now() - inicio;

      // 12 rondas de bcrypt no bajan de ~100 ms en ningún hardware razonable.
      expect(transcurrido).toBeGreaterThan(50);
    });

    it('inicia sesión con las credenciales correctas', async () => {
      usuarios.findOne.mockResolvedValue({
        id: 'id-1',
        email: 'a@b.com',
        name: 'Ana',
        passwordHash: await bcrypt.hash('la-correcta', 12),
      } as User);

      const respuesta = await servicio.login({
        email: 'a@b.com',
        password: 'la-correcta',
      });

      expect(respuesta.token).toBe('token-de-prueba');
      expect(respuesta.user).toEqual({ id: 'id-1', email: 'a@b.com', name: 'Ana' });
      // La respuesta no debe filtrar el hash.
      expect(JSON.stringify(respuesta)).not.toContain('$2');
    });
  });
});
