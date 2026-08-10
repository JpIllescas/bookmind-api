import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateDB1786298661052 implements MigrationInterface {
    name = 'UpdateDB1786298661052'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "name" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `);
        await queryRunner.query(`CREATE TABLE "document_chunks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "indice" integer NOT NULL, "pagina" integer NOT NULL, "texto" text NOT NULL, "embedding" double precision array NOT NULL, CONSTRAINT "UQ_610d31a76dfd66804064849459b" UNIQUE ("document_id", "indice"), CONSTRAINT "PK_7f9060084e9b872dbb567193978" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b371ff8bc1e4f65fc3d01420be" ON "document_chunks"  ("document_id") `);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."documents_type_enum" AS ENUM('PDF', 'EPUB')`);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."documents_materia_enum" AS ENUM('matematicas', 'ciencias_naturales', 'ciencias_sociales', 'comunicacion_lenguaje', 'ingles', 'otro')`);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."documents_nivel_enum" AS ENUM('primaria_baja', 'primaria_alta', 'basicos')`);
        await queryRunner.query(`CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "title" character varying NOT NULL, "author" character varying, "type" "bm_bookmind"."documents_type_enum" NOT NULL, "pages" integer NOT NULL DEFAULT '0', "extracted_text" text NOT NULL, "doc_embedding" double precision array NOT NULL DEFAULT '{}', "materia" "bm_bookmind"."documents_materia_enum", "nivel" "bm_bookmind"."documents_nivel_enum", "classifier_confidence" double precision, "classifier_features" jsonb, "tint_color" character varying NOT NULL DEFAULT '#B4552E', "progress" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d2f5c932adcb0788692b329373" ON "documents"  ("user_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."chat_messages_role_enum" AS ENUM('user', 'assistant')`);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."chat_messages_block_type_enum" AS ENUM('text', 'summary', 'flashcards', 'quiz')`);
        await queryRunner.query(`CREATE TABLE "chat_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" "bm_bookmind"."chat_messages_role_enum" NOT NULL, "content" text NOT NULL, "block_type" "bm_bookmind"."chat_messages_block_type_enum" NOT NULL DEFAULT 'text', "grounding_score" double precision, "citations" jsonb, "flagged_claims" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_40c55ee0e571e268b0d3cd37d10" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b0a389920a60a6168502d2bad8" ON "chat_messages"  ("document_id", "created_at") `);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."training_examples_label_materia_enum" AS ENUM('matematicas', 'ciencias_naturales', 'ciencias_sociales', 'comunicacion_lenguaje', 'ingles', 'otro')`);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."training_examples_label_nivel_enum" AS ENUM('primaria_baja', 'primaria_alta', 'basicos')`);
        await queryRunner.query(`CREATE TYPE "bm_bookmind"."training_examples_source_enum" AS ENUM('seed', 'user_feedback')`);
        await queryRunner.query(`CREATE TABLE "training_examples" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "features" jsonb NOT NULL, "label_materia" "bm_bookmind"."training_examples_label_materia_enum" NOT NULL, "label_nivel" "bm_bookmind"."training_examples_label_nivel_enum" NOT NULL, "source" "bm_bookmind"."training_examples_source_enum" NOT NULL, "source_document_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3e25ab895f28833e51482352f2a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1526cdb14ed655236d85a16be9" ON "training_examples"  ("source", "created_at") `);
        await queryRunner.query(`ALTER TABLE "document_chunks" ADD CONSTRAINT "FK_b371ff8bc1e4f65fc3d01420be5" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "documents" ADD CONSTRAINT "FK_c7481daf5059307842edef74d73" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_5a75fa80185b70220d02ffd547d" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_messages" ADD CONSTRAINT "FK_5588b6cea298cedec7063c0d33e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_5588b6cea298cedec7063c0d33e"`);
        await queryRunner.query(`ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_5a75fa80185b70220d02ffd547d"`);
        await queryRunner.query(`ALTER TABLE "documents" DROP CONSTRAINT "FK_c7481daf5059307842edef74d73"`);
        await queryRunner.query(`ALTER TABLE "document_chunks" DROP CONSTRAINT "FK_b371ff8bc1e4f65fc3d01420be5"`);
        await queryRunner.query(`DROP INDEX "bm_bookmind"."IDX_1526cdb14ed655236d85a16be9"`);
        await queryRunner.query(`DROP TABLE "training_examples"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."training_examples_source_enum"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."training_examples_label_nivel_enum"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."training_examples_label_materia_enum"`);
        await queryRunner.query(`DROP INDEX "bm_bookmind"."IDX_b0a389920a60a6168502d2bad8"`);
        await queryRunner.query(`DROP TABLE "chat_messages"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."chat_messages_block_type_enum"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."chat_messages_role_enum"`);
        await queryRunner.query(`DROP INDEX "bm_bookmind"."IDX_d2f5c932adcb0788692b329373"`);
        await queryRunner.query(`DROP TABLE "documents"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."documents_nivel_enum"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."documents_materia_enum"`);
        await queryRunner.query(`DROP TYPE "bm_bookmind"."documents_type_enum"`);
        await queryRunner.query(`DROP INDEX "bm_bookmind"."IDX_b371ff8bc1e4f65fc3d01420be"`);
        await queryRunner.query(`DROP TABLE "document_chunks"`);
        await queryRunner.query(`DROP INDEX "bm_bookmind"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
