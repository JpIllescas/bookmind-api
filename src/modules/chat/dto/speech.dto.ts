import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SpeechDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text: string;

  @IsOptional()
  @IsIn(['es', 'en'])
  idioma?: 'es' | 'en';
}
