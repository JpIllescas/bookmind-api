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

  /** Texto completo del libro; `select: false` porque pesa MB. */
  @Column({ name: 'extracted_text', type: 'text', select: false })
  extractedText: string;

  /** Ruta del archivo original dentro de UPLOAD_PATH; es lo que lee el visor. */
  @Column({ name: 'storage_path', type: 'varchar', nullable: true })
  storagePath: string | null;

  // int y no bigint: MAX_FILE_SIZE_MB nunca se acerca a 2 GB y evita leerlo como string.
  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  /** `sin_texto` marca un escaneo: se puede leer, pero no chatear con él. */
  @Column({ name: 'text_layer', default: 'ok' })
  textLayer: 'ok' | 'sin_texto';

  /** Embedding promedio: detecta libros que el usuario ya subió. */
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

  @Column({ name: 'processing_status', default: 'pending' })
  processingStatus: 'pending' | 'processing' | 'ready' | 'failed';

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => DocumentChunk, (fragmento) => fragmento.document)
  chunks: DocumentChunk[];

  @OneToMany(() => ChatMessage, (mensaje) => mensaje.document)
  messages: ChatMessage[];
}
