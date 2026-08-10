import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  email: string;

  @IsString()
  @MinLength(1, { message: 'La contraseña es obligatoria.' })
  password: string;
}
