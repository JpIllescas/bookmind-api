import { MigrationInterface, QueryRunner } from 'typeorm';

// El chat también reconoce peticiones de glosario y línea de tiempo, que ahora viven en el Studio.
export class StudioBlocks1786298661060 implements MigrationInterface {
  name = 'StudioBlocks1786298661060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "chat_messages_block_type_enum" ADD VALUE IF NOT EXISTS 'glossary';`,
    );
    await queryRunner.query(
      `ALTER TYPE "chat_messages_block_type_enum" ADD VALUE IF NOT EXISTS 'timeline';`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no quita valores de un enum; los mensajes con estos tipos seguirían siendo válidos.
  }
}
