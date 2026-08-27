import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowGoogleUsers1786298661053 implements MigrationInterface {
  name = 'AllowGoogleUsers1786298661053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ALTER COLUMN "passwordHash" SET NOT NULL',
    );
  }
}
