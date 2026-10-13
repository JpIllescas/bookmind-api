import { MigrationInterface, QueryRunner } from 'typeorm';

// Interruptor "Ayuda de Gemini" por estudiante; activado por defecto para no cambiar a nadie de golpe.
export class UsarGemini1791491794104 implements MigrationInterface {
  name = 'UsarGemini1791491794104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "usar_gemini" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "usar_gemini"`);
  }
}
