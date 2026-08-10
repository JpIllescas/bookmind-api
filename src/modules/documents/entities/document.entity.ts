import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ChatMessage } from '../../chat/entities/chat-message.entity';
import { Materia } from '../../../common/enums/materia.enum';
import { Nivel } from '../../../common/enums/nivel.enum';
import { TipoDocumento } from '../../../common/enums/tipo-documento.enum';
import { User } from '../../users/entities/user.entity';
import { DocumentChunk } from './document-chunk.entity';

/** Un libro escolar subido por un estudiante. */
@Entity('documents')
@Index(['userId', 'createdAt'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (usuario) => usuario.documents, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  title: string;

  @Column({ nullable: true, type: 'varchar' })
  author: string | null;

  @Column({ type: 'enum', enum: TipoDocumento })
  type: TipoDocumento;

  @Column({ default: 0 })
  pages: number;

  /**
   * Texto completo del libro, para el system prompt Zero-RAG.
   * `select: false`: pesa MB y la Biblioteca lista todos los documentos.
   */
  @Column({ name: 'extracted_text', type: 'text', select: false })
  extractedText: string;

  /**
   * Embedding promedio, para detectar libros ya subidos.
   * Solo se compara contra documentos del mismo usuario (sección 4.6).
   */
  @Column({ name: 'doc_embedding', type: 'double precision', array: true, default: () => "'{}'" })
  docEmbedding: number[];

  // --- Salida del clasificador (pieza 3) ---

  @Column({ type: 'enum', enum: Materia, nullable: true })
  materia: Materia | null;

  @Column({ type: 'enum', enum: Nivel, nullable: true })
  nivel: Nivel | null;

  @Column({
    name: 'classifier_confidence',
    type: 'double precision',
    nullable: true,
  })
  classifierConfidence: number | null;

  /** Qué features empujaron la decisión, para no reclasificar al mostrarlo. */
  @Column({ name: 'classifier_features', type: 'jsonb', nullable: true })
  classifierFeatures: unknown | null;

  @Column({ name: 'tint_color', default: '#B4552E' })
  tintColor: string;

  @Column({ default: 0 })
  progress: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => DocumentChunk, (fragmento) => fragmento.document)
  chunks: DocumentChunk[];

  @OneToMany(() => ChatMessage, (mensaje) => mensaje.document)
  messages: ChatMessage[];
}
