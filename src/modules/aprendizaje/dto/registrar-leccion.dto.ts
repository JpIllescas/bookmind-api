import { IsInt, Max, Min } from 'class-validator';

export class RegistrarLeccionDto {
  @IsInt()
  @Min(0)
  aciertos: number;

  @IsInt()
  @Min(1)
  @Max(20)
  total: number;
}
