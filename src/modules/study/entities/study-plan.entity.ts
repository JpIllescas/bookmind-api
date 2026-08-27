import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('study_plans')
@Index(['userId', 'active'])
export class StudyPlan {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column() title: string;
  @Column({ type: 'date', nullable: true }) targetDate: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) tasks: unknown[];
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
