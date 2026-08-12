import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RolMensaje } from '../../../common/enums/rol-mensaje.enum';
import { TipoBloque } from '../../../common/enums/tipo-bloque.enum';
import { Document } from '../../documents/entities/document.entity';
import { User } from '../../users/entities/user.entity';

/** Una cita concreta: de dónde salió una afirmación de la IA. */
export interface Cita {
  claim: string;
  page: number;
  score: number;
}

@Entity('chat_messages')
@Index(['documentId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, (documento) => documento.messages, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (usuario) => usuario.messages, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: RolMensaje })
  role: RolMensaje;

  @Column({ type: 'text' })
  content: string;

  @Column({
    name: 'block_type',
    type: 'enum',
    enum: TipoBloque,
    default: TipoBloque.Text,
  })
  blockType: TipoBloque;

  // --- Salida del verificador de anclaje (pieza 2); solo en mensajes de la IA ---

  /** 0..1. Qué tan anclada al libro está la respuesta. */
  @Column({ name: 'grounding_score', type: 'double precision', nullable: true })
  groundingScore: number | null;

  @Column({ type: 'jsonb', nullable: true })
  citations: Cita[] | null;

  /** Afirmaciones por debajo del umbral: posible alucinación. */
  @Column({ name: 'flagged_claims', type: 'jsonb', nullable: true })
  flaggedClaims: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
