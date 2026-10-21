import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { LARGO_MAXIMO_AUTOR, LARGO_MAXIMO_TITULO } from '../services/titulo-del-libro';

// Sin esto, un título de puros espacios pasaría el MinLength.
const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RenombrarDocumentoDto {
  @Transform(recortar)
  @IsString({ message: 'Escribe el título del libro.' })
  @MinLength(1, { message: 'El título no puede quedar vacío. Escribe cómo quieres llamar al libro.' })
  @MaxLength(LARGO_MAXIMO_TITULO, {
    message: `El título es demasiado largo. Usa como máximo ${LARGO_MAXIMO_TITULO} caracteres.`,
  })
  titulo: string;

  /** Vacío o null quita el autor; ausente lo deja como estaba. */
  @IsOptional()
  @Transform(recortar)
  @IsString({ message: 'El autor debe ser un texto.' })
  @MaxLength(LARGO_MAXIMO_AUTOR, {
    message: `El nombre del autor es demasiado largo. Usa como máximo ${LARGO_MAXIMO_AUTOR} caracteres.`,
  })
  autor?: string | null;
}
