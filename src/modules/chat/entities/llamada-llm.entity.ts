import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Cada llamada al modelo externo, para reportar latencia y fallos más allá de un reinicio. */
@Entity('llm_calls')
export class LlamadaLlm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_llm_calls_instante')
  @CreateDateColumn({ name: 'instante' })
  instante: Date;

  @Column({ type: 'varchar', length: 32 })
  proveedor: string;

  @Column({ type: 'varchar', length: 64 })
  modelo: string;

  @Column({ type: 'integer' })
  ms: number;

  /** ok | saturado | cuota | error */
  @Column({ type: 'varchar', length: 16 })
  resultado: string;

  @Column({ type: 'text', nullable: true })
  mensaje: string | null;
}
