import { MigrationInterface, QueryRunner } from 'typeorm';

// El progreso medía páginas leídas; los quiz resueltos se perdían al recargar.
export class QuizAttempts1786298661058 implements MigrationInterface {
  name = 'QuizAttempts1786298661058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "quiz_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "content_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "aciertos" integer NOT NULL,
        "total" integer NOT NULL,
        "falladas" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quiz_attempts" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_quiz_attempts_user_document"
          ON "quiz_attempts" ("user_id", "document_id");
    `);

    // Al borrar el material, el libro o la cuenta, los intentos se van con ellos.
    await queryRunner.query(`
      ALTER TABLE "quiz_attempts"
          ADD CONSTRAINT "FK_quiz_attempts_content"
          FOREIGN KEY ("content_id")
          REFERENCES "generated_contents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
    await queryRunner.query(`
      ALTER TABLE "quiz_attempts"
          ADD CONSTRAINT "FK_quiz_attempts_document"
          FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
    await queryRunner.query(`
      ALTER TABLE "quiz_attempts"
          ADD CONSTRAINT "FK_quiz_attempts_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "quiz_attempts";`);
  }
}
