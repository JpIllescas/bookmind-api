import { IsBoolean } from 'class-validator';

export class GuardarAyudaGeminiDto {
  @IsBoolean()
  activada: boolean;
}
