import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudyPreferences1786298661054 implements MigrationInterface {
  name = 'AddStudyPreferences1786298661054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "preferences" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "preferences"`);
  }
}
