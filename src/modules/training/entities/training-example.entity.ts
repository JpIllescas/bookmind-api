import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Materia } from '../../../common/enums/materia.enum';
import { Nivel } from '../../../common/enums/nivel.enum';
import { OrigenEjemplo } from '../../../common/enums/origen-ejemplo.enum';

/** Ejemplo para reentrenar el clasificador; solo etiquetas confirmadas por una persona. */
@Entity('training_examples')
@Index(['source', 'createdAt'])
export class TrainingExample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Features del documento; el texto del libro no se guarda. */
  @Column({ type: 'jsonb' })
  features: Record<string, number>;

  @Column({ name: 'label_materia', type: 'enum', enum: Materia })
  labelMateria: Materia;

  @Column({ name: 'label_nivel', type: 'enum', enum: Nivel })
  labelNivel: Nivel;

  @Column({ type: 'enum', enum: OrigenEjemplo })
  source: OrigenEjemplo;

  /** Null si el documento se borra: el ejemplo sobrevive, el vínculo no. */
  @Column({ name: 'source_document_id', type: 'uuid', nullable: true })
  sourceDocumentId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
