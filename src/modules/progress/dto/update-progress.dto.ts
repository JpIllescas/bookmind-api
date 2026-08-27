import { IsInt, Max, Min } from 'class-validator';

export class UpdateProgressDto {
  @IsInt() @Min(0) @Max(100) progress: number;
}
