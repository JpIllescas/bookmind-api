import { IsArray, IsDateString, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StudyTaskDto {
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class CreateStudyPlanDto {
  @IsString() @MaxLength(120) title: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StudyTaskDto)
  tasks?: StudyTaskDto[];
}
