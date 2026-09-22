import { MigrationInterface, QueryRunner } from 'typeorm';

// Sesiones de chat por libro: los mensajes viejos se agrupan en una conversación por libro y usuario.
export class Conversations1786298661061 implements MigrationInterface {
  name = 'Conversations1786298661061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "titulo" character varying(120) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversations_document" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversations_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_conversations_document_user_updated" ON "conversations" ("document_id", "user_id", "updated_at")`,
    );

    await queryRunner.query(`ALTER TABLE "chat_messages" ADD "conversation_id" uuid`);

    // Cada par (libro, usuario) con historial recibe una conversación con lo que ya había.
    await queryRunner.query(`
      INSERT INTO "conversations" ("document_id", "user_id", "titulo", "created_at", "updated_at")
      SELECT "document_id", "user_id", 'Conversación anterior', MIN("created_at"), MAX("created_at")
      FROM "chat_messages"
      GROUP BY "document_id", "user_id"
    `);
    await queryRunner.query(`
      UPDATE "chat_messages" m
      SET "conversation_id" = c."id"
      FROM "conversations" c
      WHERE c."document_id" = m."document_id" AND c."user_id" = m."user_id"
    `);

    await queryRunner.query(
      `ALTER TABLE "chat_messages" ALTER COLUMN "conversation_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
      ADD CONSTRAINT "FK_chat_messages_conversation" FOREIGN KEY ("conversation_id")
        REFERENCES "conversations"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_chat_messages_conversation_created" ON "chat_messages" ("conversation_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_chat_messages_conversation_created"`);
    await queryRunner.query(
      `ALTER TABLE "chat_messages" DROP CONSTRAINT "FK_chat_messages_conversation"`,
    );
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "conversation_id"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
  }
}
