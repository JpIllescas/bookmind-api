import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CrearConversacionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  titulo?: string;
}

export class RenombrarConversacionDto {
  @IsString()
  @MinLength(1, { message: 'Ponle un nombre a la conversación.' })
  @MaxLength(120, { message: 'El nombre no puede pasar de 120 caracteres.' })
  titulo: string;
}
