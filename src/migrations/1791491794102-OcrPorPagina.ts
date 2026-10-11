import { MigrationInterface, QueryRunner } from 'typeorm';

// OCR por página: de dónde salió el texto de cada página y qué tan fiable es.
export class OcrPorPagina1791491794102 implements MigrationInterface {
  name = 'OcrPorPagina1791491794102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
          ADD "paginas_ocr"         int NOT NULL DEFAULT 0,
          ADD "confianza_ocr_media" double precision,
          ADD "progreso_ocr"        jsonb,
          ADD "origen_paginas"      jsonb;
    `);

    await queryRunner.query(`ALTER TABLE "document_chunks" ADD "confianza_ocr" double precision;`);

    await queryRunner.query(`
      COMMENT ON COLUMN "documents"."paginas_ocr"         IS 'Páginas leídas con OCR; 0 si todo el texto es nativo';
      COMMENT ON COLUMN "documents"."confianza_ocr_media" IS 'Confianza media de Tesseract (0-1) en las páginas con OCR';
      COMMENT ON COLUMN "documents"."progreso_ocr"        IS '{procesadas, total} mientras processing_status = ocr';
      COMMENT ON COLUMN "documents"."origen_paginas"      IS '[{pagina, origen: nativo|ocr, confianza}] en libros que usaron OCR';
      COMMENT ON COLUMN "document_chunks"."confianza_ocr" IS 'Confianza del OCR de la página del fragmento; NULL si es nativo';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "document_chunks" DROP COLUMN "confianza_ocr";`);
    await queryRunner.query(`
      ALTER TABLE "documents"
          DROP COLUMN "origen_paginas",
          DROP COLUMN "progreso_ocr",
          DROP COLUMN "confianza_ocr_media",
          DROP COLUMN "paginas_ocr";
    `);
  }
}
