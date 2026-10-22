import { MigrationInterface, QueryRunner } from 'typeorm';

export class Onboarding1791491794109 implements MigrationInterface {
  name = 'Onboarding1791491794109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completado" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "onboarding_completado"`,
    );
  }
}
