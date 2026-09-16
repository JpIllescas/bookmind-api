import { MigrationInterface, QueryRunner } from 'typeorm';

// El archivo original se conserva para que el visor lo abra tal cual, con sus imágenes.
export class AddDocumentFile1786298661056 implements MigrationInterface {
  name = 'AddDocumentFile1786298661056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Archivo original ---
    await queryRunner.query(`
      ALTER TABLE "documents"
          ADD "storage_path" character varying;
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
          ADD "file_size" integer;
    `);

    // --- Calidad del texto extraído ---
    await queryRunner.query(`
      ALTER TABLE "documents"
          ADD "text_layer" character varying NOT NULL DEFAULT 'ok';
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "bm_bookmind"."documents"."storage_path"  IS 'Ruta del archivo dentro de UPLOAD_PATH: "<user_id>/<document_id>.<ext>". NULL en los documentos subidos antes de esta migración';
      COMMENT ON COLUMN "bm_bookmind"."documents"."file_size"     IS 'Tamaño en bytes del archivo original';
      COMMENT ON COLUMN "bm_bookmind"."documents"."text_layer"    IS 'ok = tiene texto seleccionable; sin_texto = escaneo de imágenes, se puede leer pero no alimenta al chat ni al clasificador';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
          DROP COLUMN "text_layer";
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
          DROP COLUMN "file_size";
    `);
    await queryRunner.query(`
      ALTER TABLE "documents"
          DROP COLUMN "storage_path";
    `);
  }
}
