import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Una lección terminada: de aquí salen las coronas, el XP y la racha. */
@Entity('lesson_attempts')
@Index(['userId', 'documentId'])
@Index(['userId', 'createdAt'])
export class LessonAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'document_id' }) documentId: string;
  @Column({ name: 'chapter_id' }) chapterId: string;
  @Column({ type: 'int' }) aciertos: number;
  @Column({ type: 'int' }) total: number;
  @Column({ type: 'int' }) xp: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
