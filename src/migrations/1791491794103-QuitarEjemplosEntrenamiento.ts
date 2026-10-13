import { MigrationInterface, QueryRunner } from 'typeorm';

// training_examples nunca se conectó: el clasificador se entrena en el ml-service desde su corpus semilla.
export class QuitarEjemplosEntrenamiento1791491794103 implements MigrationInterface {
  name = 'QuitarEjemplosEntrenamiento1791491794103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "training_examples"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bm_bookmind"."training_examples_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bm_bookmind"."training_examples_label_nivel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bm_bookmind"."training_examples_label_materia_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "bm_bookmind"."training_examples_label_materia_enum" AS ENUM('matematicas', 'ciencias_naturales', 'ciencias_sociales', 'comunicacion_lenguaje', 'ingles', 'otro')`,
    );
    await queryRunner.query(
      `CREATE TYPE "bm_bookmind"."training_examples_label_nivel_enum" AS ENUM('primaria_baja', 'primaria_alta', 'basicos')`,
    );
    await queryRunner.query(
      `CREATE TYPE "bm_bookmind"."training_examples_source_enum" AS ENUM('seed', 'user_feedback')`,
    );
    await queryRunner.query(
      `CREATE TABLE "training_examples" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "features" jsonb NOT NULL, "label_materia" "bm_bookmind"."training_examples_label_materia_enum" NOT NULL, "label_nivel" "bm_bookmind"."training_examples_label_nivel_enum" NOT NULL, "source" "bm_bookmind"."training_examples_source_enum" NOT NULL, "source_document_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3e25ab895f28833e51482352f2a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1526cdb14ed655236d85a16be9" ON "training_examples" ("source", "created_at")`,
    );
  }
}
