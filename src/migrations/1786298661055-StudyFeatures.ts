import { MigrationInterface, QueryRunner } from 'typeorm';

export class StudyFeatures1786298661055 implements MigrationInterface {
  name = 'StudyFeatures1786298661055';
  async up(q: QueryRunner): Promise<void> {
    // Los documentos existentes ya fueron procesados; solo las subidas nuevas empiezan pendientes.
    await q.query(`ALTER TABLE "documents" ADD "processing_status" varchar NOT NULL DEFAULT 'ready'`);
    await q.query(`ALTER TABLE "documents" ALTER COLUMN "processing_status" SET DEFAULT 'pending'`);
    await q.query(`ALTER TABLE "documents" ADD "processing_error" text`);
    await q.query(`CREATE TABLE "study_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" varchar NOT NULL, "targetDate" date, "tasks" jsonb NOT NULL DEFAULT '[]', "active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_study_plans" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_study_plans_user_active" ON "study_plans" ("user_id", "active")`);
    await q.query(`CREATE TABLE "generated_contents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "user_id" uuid NOT NULL, "type" varchar NOT NULL, "content" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_generated_contents" PRIMARY KEY ("id"))`);
    await q.query(`CREATE INDEX "IDX_generated_contents_document_type" ON "generated_contents" ("document_id", "type")`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "generated_contents"`);
    await q.query(`DROP TABLE "study_plans"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "processing_error"`);
    await q.query(`ALTER TABLE "documents" DROP COLUMN "processing_status"`);
  }
}
