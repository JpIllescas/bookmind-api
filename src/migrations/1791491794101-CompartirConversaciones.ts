import { MigrationInterface, QueryRunner } from 'typeorm';

// Idempotente: reemplaza a AddConversationSharing1786298661057, que pudo haber corrido ya con un índice parcial.
export class CompartirConversaciones1791491794101 implements MigrationInterface {
  name = 'CompartirConversaciones1791491794101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "share_token" character varying(64)`,
    );
    // Si ya existe el índice único de la migración anterior, la unicidad está cubierta y no se duplica.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UQ_f581a1e4702aaebd4235dca5ebe'
                         AND conrelid = to_regclass('"conversations"'))
           AND to_regclass('"IDX_conversations_share_token"') IS NULL THEN
          ALTER TABLE "conversations" ADD CONSTRAINT "UQ_f581a1e4702aaebd4235dca5ebe" UNIQUE ("share_token");
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "UQ_f581a1e4702aaebd4235dca5ebe"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversations_share_token"`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "share_token"`);
  }
}
