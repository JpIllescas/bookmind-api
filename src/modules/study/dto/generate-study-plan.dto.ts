import { IsUUID } from 'class-validator';

export class GenerateStudyPlanDto {
  @IsUUID()
  documentId: string;
}
