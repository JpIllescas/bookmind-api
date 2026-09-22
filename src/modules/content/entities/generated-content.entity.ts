import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type GeneratedContentType = 'summary' | 'flashcards' | 'quiz' | 'glossary' | 'timeline';

@Entity('generated_contents')
@Index(['documentId', 'type'])
export class GeneratedContent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'document_id' }) documentId: string;
  @Column({ name: 'user_id' }) userId: string;
  // En la base es varchar: agregar un tipo no necesita migración.
  @Column({ type: 'varchar' }) type: GeneratedContentType;
  @Column({ type: 'jsonb' }) content: unknown;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
