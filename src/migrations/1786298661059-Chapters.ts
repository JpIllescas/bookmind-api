import { MigrationInterface, QueryRunner } from 'typeorm';

// El libro pasa a tener estructura: capítulos para navegar y para estudiar por partes.
export class Chapters1786298661059 implements MigrationInterface {
  name = 'Chapters1786298661059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chapters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "orden" integer NOT NULL,
        "titulo" character varying NOT NULL,
        "pagina_inicio" integer NOT NULL,
        "pagina_fin" integer NOT NULL,
        CONSTRAINT "PK_chapters" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chapters_document_orden" UNIQUE ("document_id", "orden")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_chapters_document" ON "chapters" ("document_id");
    `);

    await queryRunner.query(`
      ALTER TABLE "chapters"
          ADD CONSTRAINT "FK_chapters_document"
          FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    `);

    // Cada fragmento sabe a qué capítulo pertenece; si el capítulo se recalcula, queda en null.
    await queryRunner.query(`
      ALTER TABLE "document_chunks" ADD "chapter_id" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "document_chunks"
          ADD CONSTRAINT "FK_document_chunks_chapter"
          FOREIGN KEY ("chapter_id")
          REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_chunks" DROP CONSTRAINT "FK_document_chunks_chapter";`,
    );
    await queryRunner.query(`ALTER TABLE "document_chunks" DROP COLUMN "chapter_id";`);
    await queryRunner.query(`DROP TABLE "chapters";`);
  }
}
