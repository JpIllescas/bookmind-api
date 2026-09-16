import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Pregunta que el estudiante falló, guardada para saber qué repasar. */
export interface PreguntaFallada {
  pregunta: string;
  elegida: string;
  correcta: string;
}

/**
 * Un quiz resuelto. Es la única evidencia de comprensión que produce BookMind:
 * las páginas leídas dicen cuánto avanzó, no cuánto entendió.
 */
@Entity('quiz_attempts')
@Index(['userId', 'documentId'])
export class QuizAttempt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'content_id' }) contentId: string;
  @Column({ name: 'document_id' }) documentId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ type: 'int' }) aciertos: number;
  @Column({ type: 'int' }) total: number;
  @Column({ type: 'jsonb', default: () => "'[]'" }) falladas: PreguntaFallada[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
