import { MigrationInterface, QueryRunner } from 'typeorm';

// Ruta de aprendizaje: ejercicios por unidad y lecciones terminadas (XP, coronas, racha).
export class Aprendizaje1786298661062 implements MigrationInterface {
  name = 'Aprendizaje1786298661062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lessons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "chapter_id" uuid NOT NULL,
        "ejercicios" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lessons" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lessons_document_chapter" UNIQUE ("document_id", "chapter_id"),
        CONSTRAINT "FK_lessons_document" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lessons_chapter" FOREIGN KEY ("chapter_id")
          REFERENCES "chapters"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_lessons_document" ON "lessons" ("document_id")`);

    await queryRunner.query(`
      CREATE TABLE "lesson_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "chapter_id" uuid NOT NULL,
        "aciertos" integer NOT NULL,
        "total" integer NOT NULL,
        "xp" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lesson_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lesson_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lesson_attempts_document" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_lesson_attempts_chapter" FOREIGN KEY ("chapter_id")
          REFERENCES "chapters"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lesson_attempts_user_document" ON "lesson_attempts" ("user_id", "document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_lesson_attempts_user_created" ON "lesson_attempts" ("user_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "lesson_attempts"`);
    await queryRunner.query(`DROP TABLE "lessons"`);
  }
}
