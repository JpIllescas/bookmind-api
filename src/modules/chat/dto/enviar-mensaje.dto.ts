import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class EnviarMensajeDto {
  @IsUUID()
  documentId: string;

  @IsString()
  @MinLength(1, { message: 'Escribe una pregunta.' })
  // Un mensaje mucho más largo que esto no es una pregunta sobre el libro.
  @MaxLength(2000)
  message: string;
}
