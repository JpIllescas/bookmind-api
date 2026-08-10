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

/**
 * Ejemplo para reentrenar el clasificador (sección 4.4). Solo etiquetas
 * confirmadas por una persona: reentrenar con la propia salida lo degrada.
 */
@Entity('training_examples')
@Index(['source', 'createdAt'])
export class TrainingExample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Features del documento. No se guarda el texto del libro (sección 4.6). */
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
