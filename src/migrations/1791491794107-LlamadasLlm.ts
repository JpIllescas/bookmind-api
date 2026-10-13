import { MigrationInterface, QueryRunner } from 'typeorm';

// Las métricas del modelo vivían solo en memoria; aquí sobreviven al reinicio para reportar p50/p95.
export class LlamadasLlm1791491794107 implements MigrationInterface {
  name = 'LlamadasLlm1791491794107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "llm_calls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "instante" TIMESTAMP NOT NULL DEFAULT now(),
        "proveedor" character varying(32) NOT NULL,
        "modelo" character varying(64) NOT NULL,
        "ms" integer NOT NULL,
        "resultado" character varying(16) NOT NULL,
        "mensaje" text,
        CONSTRAINT "PK_llm_calls" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_llm_calls_instante" ON "llm_calls" ("instante")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "llm_calls"`);
  }
}
