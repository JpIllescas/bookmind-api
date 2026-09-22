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

import { Document } from '../../documents/entities/document.entity';
import { User } from '../../users/entities/user.entity';
import { ChatMessage } from './chat-message.entity';

/** Una sesión de chat sobre un libro: el estudiante puede tener varias por libro. */
@Entity('conversations')
@Index(['documentId', 'userId', 'updatedAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Sale de la primera pregunta; el estudiante puede cambiarlo. */
  @Column({ length: 120 })
  titulo: string;

  @OneToMany(() => ChatMessage, (mensaje) => mensaje.conversation)
  messages: ChatMessage[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Se toca con cada mensaje: ordena la lista por actividad reciente. */
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
