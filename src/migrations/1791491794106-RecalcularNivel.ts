import { MigrationInterface, QueryRunner } from 'typeorm';

// Cambiaron los cortes de legibilidad (83/60): sin modelo asociado, ReclasificacionService vuelve a clasificar todo al arrancar.
export class RecalcularNivel1791491794106 implements MigrationInterface {
  name = 'RecalcularNivel1791491794106';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "documents" SET "clasificado_con" = NULL`);
  }

  // No hay nada que deshacer: el nivel recalculado es el correcto con los cortes vigentes.
  public async down(): Promise<void> {}
}
