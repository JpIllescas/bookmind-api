import { IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class StudyTaskDto {
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class CreateStudyPlanDto {
  // Sin recortar, un título de puros espacios pasaría como válido.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Escribe un nombre para el plan.' })
  @MaxLength(120, { message: 'El nombre del plan no puede pasar de 120 caracteres.' })
  title: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StudyTaskDto)
  tasks?: StudyTaskDto[];
}
