import { MigrationInterface, QueryRunner } from 'typeorm';

// Copia congelada de tituloDesdeArchivo (20-oct): si la función cambia, esta migración debe seguir haciendo lo mismo.
const SUFIJO =
  /(?:\s*\(\d+\)|\s*\[\d+\]|\s+-\s+(?:copia|copy)|[\s._-]+(?:ilovepdf|compressed|comprimido|optimizado|optimized))$/i;

const espacios = (texto: string) => texto.replace(/\s+/g, ' ').trim();

function limpiarTitulo(original: string): string {
  let titulo = espacios(original.replace(/_+/g, ' '));
  for (let anterior = ''; anterior !== titulo; ) {
    anterior = titulo;
    titulo = espacios(titulo.replace(SUFIJO, ''));
  }
  titulo = espacios(titulo.replace(/-+/g, ' '));
  const [primera] = titulo.split(' ');
  if (primera && /^\p{Ll}+$/u.test(primera)) {
    titulo = primera.charAt(0).toLocaleUpperCase('es') + titulo.slice(1);
  }
  return titulo.slice(0, 200) || original;
}

// Los títulos ya guardados venían del nombre del archivo tal cual ("el principito (1)", "… compressed").
// TypeORM instancia todo lo que exporta este archivo: la limpieza viaja como estático, no como export suelto.
export class LimpiarTitulos1791491794108 implements MigrationInterface {
  name = 'LimpiarTitulos1791491794108';

  static readonly limpiarTitulo = limpiarTitulo;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const filas = (await queryRunner.query(`SELECT "id", "title" FROM "documents"`)) as Array<{ id: string; title: string }>;

    for (const { id, title } of filas) {
      const limpio = limpiarTitulo(title);
      if (limpio !== title) {
        await queryRunner.query(`UPDATE "documents" SET "title" = $1 WHERE "id" = $2`, [limpio, id]);
      }
    }
  }

  // El título original solo era el nombre del archivo; no hay nada que valga la pena restaurar.
  public async down(): Promise<void> {}
}
