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

/** Estructura del libro: la unidad de navegación y, más adelante, de estudio. */
@Entity('chapters')
@Unique(['documentId', 'orden'])
@Index(['documentId'])
export class Chapter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  /** Posición dentro del libro, desde 1. */
  @Column()
  orden: number;

  @Column()
  titulo: string;

  @Column({ name: 'pagina_inicio' })
  paginaInicio: number;

  @Column({ name: 'pagina_fin' })
  paginaFin: number;
}
