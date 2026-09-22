import { IsIn } from 'class-validator';
import type { GeneratedContentType } from '../entities/generated-content.entity';

export class GenerateContentDto {
  @IsIn(['summary', 'flashcards', 'quiz', 'glossary', 'timeline']) type: GeneratedContentType;
}
