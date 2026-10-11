import { MigrationInterface, QueryRunner } from 'typeorm';

// Generada con migration:generate y recortada a share_token: el resto del diff era deriva antigua que borraba columnas.
export class CompartirConversaciones1791491794101 implements MigrationInterface {
  name = 'CompartirConversaciones1791491794101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD "share_token" character varying(64)`);
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "UQ_f581a1e4702aaebd4235dca5ebe" UNIQUE ("share_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "UQ_f581a1e4702aaebd4235dca5ebe"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "share_token"`);
  }
}
