import { IsString, MaxLength, MinLength } from 'class-validator';

export class PreguntarBibliotecaDto {
  @IsString()
  @MinLength(3, { message: 'Escribe al menos unas palabras.' })
  @MaxLength(500, { message: 'La pregunta no puede pasar de 500 caracteres.' })
  pregunta: string;
}
