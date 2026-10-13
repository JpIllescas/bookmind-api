import { MigrationInterface, QueryRunner } from 'typeorm';

// Fecha del modelo que clasificó cada libro: al reentrenar, el backend reclasifica los que quedaron atrás.
export class ClasificadoCon1791491794105 implements MigrationInterface {
  name = 'ClasificadoCon1791491794105';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "clasificado_con" varchar NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN IF EXISTS "clasificado_con"`);
  }
}
