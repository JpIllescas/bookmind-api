import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegistrarDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;

  // Sin reglas de composición: empujan a contraseñas predecibles.
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  // bcrypt trunca en 72 bytes en silencio; mejor rechazar.
  @MaxLength(72, {
    message: 'La contraseña no puede pasar de 72 caracteres.',
  })
  password: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;
}
