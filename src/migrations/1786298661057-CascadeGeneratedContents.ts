import { MigrationInterface, QueryRunner } from 'typeorm';

// Al borrar un libro deben irse con él sus materiales; las tablas nuevas no tenían FK.
export class CascadeGeneratedContents1786298661057 implements MigrationInterface {
  name = 'CascadeGeneratedContents1786298661057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Materiales huérfanos de documentos ya inexistentes ---
    await queryRunner.query(`
      DELETE FROM "generated_contents"
      WHERE "document_id" NOT IN (SELECT "id" FROM "documents");
    `);

    // --- Materiales generados ---
    await queryRunner.query(`
      ALTER TABLE "generated_contents"
          ADD CONSTRAINT "FK_generated_contents_document"
          FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_contents"
          ADD CONSTRAINT "FK_generated_contents_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);

    // --- Planes de estudio ---
    await queryRunner.query(`
      ALTER TABLE "study_plans"
          ADD CONSTRAINT "FK_study_plans_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "study_plans"
          DROP CONSTRAINT "FK_study_plans_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_contents"
          DROP CONSTRAINT "FK_generated_contents_user";
    `);
    await queryRunner.query(`
      ALTER TABLE "generated_contents"
          DROP CONSTRAINT "FK_generated_contents_document";
    `);
  }
}
