import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationSharing1786298661057 implements MigrationInterface {
  name = 'AddConversationSharing1786298661057';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "conversations" ADD "share_token" character varying(64)');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_conversations_share_token" ON "conversations" ("share_token") WHERE "share_token" IS NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_conversations_share_token"');
    await queryRunner.query('ALTER TABLE "conversations" DROP COLUMN "share_token"');
  }
}
