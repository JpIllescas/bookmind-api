import { IsIn, IsOptional } from 'class-validator';
import type { GeneratedContentType } from '../entities/generated-content.entity';

export class GenerateContentDto {
  @IsIn(['summary', 'flashcards', 'quiz', 'glossary', 'timeline', 'mind_map', 'concept_map']) type: GeneratedContentType;
  @IsOptional()
  @IsIn(['es', 'en']) idioma?: 'es' | 'en';
}
