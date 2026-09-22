import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Tipos de ejercicio que la pantalla de lección sabe pintar. */
export type TipoEjercicio = 'opcion' | 'hueco' | 'verdadero_falso';

export interface Ejercicio {
  tipo: TipoEjercicio;
  /** Enunciado; en `hueco` lleva la frase con "_____". */
  enunciado: string;
  /** Opciones a elegir; en `verdadero_falso` son ["Verdadero", "Falso"]. */
  opciones: string[];
  correcta: number;
  pagina: number | null;
  /** Qué decía el libro, para el feedback al fallar. */
  explicacion: string | null;
}

/**
 * Ejercicios de una unidad (capítulo o tramo), generados por el motor propio
 * y guardados para no volver a pedirlos cada vez que se abre la lección.
 */
@Entity('lessons')
@Unique(['documentId', 'chapterId'])
@Index(['documentId'])
export class Lesson {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'document_id' }) documentId: string;
  /** Primer capítulo del tramo. */
  @Column({ name: 'chapter_id' }) chapterId: string;
  @Column({ type: 'jsonb' }) ejercicios: Ejercicio[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
