import { MigrationInterface, QueryRunner } from 'typeorm';

const EXPRESION_TSV = `to_tsvector('spanish', "texto")`;

// Búsqueda híbrida: al coseno en Node se le suma texto completo en español con índice GIN.
export class BusquedaLexica1786298661063 implements MigrationInterface {
  name = 'BusquedaLexica1786298661063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Columna generada: Postgres la mantiene al insertar, el backend nunca la escribe.
    await queryRunner.query(`
      ALTER TABLE "document_chunks"
          ADD "tsv" tsvector
          GENERATED ALWAYS AS (${EXPRESION_TSV}) STORED;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_document_chunks_tsv" ON "document_chunks" USING GIN ("tsv");
    `);

    // TypeORM guarda aquí la expresión de las columnas generadas; sin ella migration:generate falla.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "typeorm_metadata" (
          "type"     varchar NOT NULL,
          "database" varchar,
          "schema"   varchar,
          "table"    varchar,
          "name"     varchar,
          "value"    text
      );
    `);

    await queryRunner.query(
      `INSERT INTO "typeorm_metadata" ("database", "schema", "table", "type", "name", "value")
       VALUES ($1, $2, 'document_chunks', 'GENERATED_COLUMN', 'tsv', $3)`,
      [await queryRunner.getCurrentDatabase(), await queryRunner.getCurrentSchema(), EXPRESION_TSV],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('typeorm_metadata')) {
      await queryRunner.query(
        `DELETE FROM "typeorm_metadata"
         WHERE "type" = 'GENERATED_COLUMN' AND "table" = 'document_chunks' AND "name" = 'tsv'`,
      );
    }
    await queryRunner.query(`DROP INDEX "IDX_document_chunks_tsv";`);
    await queryRunner.query(`ALTER TABLE "document_chunks" DROP COLUMN "tsv";`);
  }
}
