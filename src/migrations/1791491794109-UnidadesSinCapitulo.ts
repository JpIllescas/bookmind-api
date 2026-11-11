import { MigrationInterface, QueryRunner } from 'typeorm';

// Las unidades por páginas no existen en "chapters": con la llave foránea no se podía guardar su lección ni su intento.
export class UnidadesSinCapitulo1791491794109 implements MigrationInterface {
  name = 'UnidadesSinCapitulo1791491794109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "FK_lessons_chapter"`);
    await queryRunner.query(
      `ALTER TABLE "lesson_attempts" DROP CONSTRAINT IF EXISTS "FK_lesson_attempts_chapter"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Lo guardado para unidades por páginas no cabe en la llave foránea.
    for (const tabla of ['lessons', 'lesson_attempts']) {
      await queryRunner.query(
        `DELETE FROM "${tabla}" WHERE "chapter_id" NOT IN (SELECT "id" FROM "chapters")`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE "lessons" ADD CONSTRAINT "FK_lessons_chapter"
        FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "lesson_attempts" ADD CONSTRAINT "FK_lesson_attempts_chapter"
        FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE
    `);
  }
}
