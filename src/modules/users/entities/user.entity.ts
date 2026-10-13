import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ChatMessage } from '../../chat/entities/chat-message.entity';
import { Document } from '../../documents/entities/document.entity';
import { PreferenciasEstudio } from '../../../common/enums/preferencias-estudio.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ unique: true })
  email: string;

  /** `select: false` para que no salga por accidente en un `find()`. */
  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column()
  name: string;

  @Column({ type: 'jsonb', nullable: true, default: null })
  preferences: PreferenciasEstudio | null;

  /** Si el estudiante quiere que Gemini redacte; sin él, todo sale del motor propio. */
  @Column({ name: 'usar_gemini', type: 'boolean', default: true })
  usarGemini: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Document, (documento) => documento.user)
  documents: Document[];

  @OneToMany(() => ChatMessage, (mensaje) => mensaje.user)
  messages: ChatMessage[];
}
