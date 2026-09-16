import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PreguntaFalladaDto {
  @IsString() @MaxLength(500) pregunta: string;
  @IsString() @MaxLength(500) elegida: string;
  @IsString() @MaxLength(500) correcta: string;
}

export class RegistrarIntentoDto {
  @IsInt() @Min(0) aciertos: number;
  @IsInt() @Min(1) total: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PreguntaFalladaDto)
  falladas: PreguntaFalladaDto[];
}
