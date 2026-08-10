import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { Document } from './document.entity';

/**
 * Fragmento del libro con su embedding. Índice de la pieza 2 para las citas
 * por página, y recuperación de respaldo si el libro no cabe en contexto.
 */
@Entity('document_chunks')
@Unique(['documentId', 'indice'])
@Index(['documentId'])
export class DocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, (documento) => documento.chunks, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  /** Posición dentro del libro, desde 0. */
  @Column()
  indice: number;

  /** Página de origen. Es lo que se le muestra al estudiante como cita. */
  @Column()
  pagina: number;

  @Column({ type: 'text' })
  texto: string;

  /** Coseno calculado en Node; a escala de un libro no hace falta pgvector. */
  @Column({ type: 'double precision', array: true })
  embedding: number[];
}
