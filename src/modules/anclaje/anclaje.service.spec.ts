import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DocumentChunk } from '../documents/entities/document-chunk.entity';
import { AnclajeService } from './anclaje.service';
import { BusquedaLexicaService } from './services/busqueda-lexica.service';
import { EmbeddingsService } from './services/embeddings.service';
import { FragmentacionService } from './services/fragmentacion.service';
import { MuestreoService } from './services/muestreo.service';

const EJE_X = [1, 0, 0];
const EJE_Y = [0, 1, 0];
const CASI_X = [0.97, 0.243, 0];

function crearRepositorioFalso() {
  return {
    find: jest.fn<Promise<DocumentChunk[]>, [unknown]>(),
    create: jest.fn((datos: Partial<DocumentChunk>) => datos as DocumentChunk),
    save: jest.fn(async (filas: unknown) => filas as DocumentChunk[]),
  };
}

describe('AnclajeService', () => {
  let servicio: AnclajeService;
  let fragmentos: ReturnType<typeof crearRepositorioFalso>;
  let embeddings: { embeberPasajes: jest.Mock; embeberConsultas: jest.Mock };
  let lexica: { enDocumento: jest.Mock; enBiblioteca: jest.Mock };

  beforeEach(async () => {
    fragmentos = crearRepositorioFalso();
    embeddings = { embeberPasajes: jest.fn(), embeberConsultas: jest.fn() };
    lexica = {
      enDocumento: jest.fn().mockResolvedValue([]),
      enBiblioteca: jest.fn().mockResolvedValue([]),
    };

    const modulo = await Test.createTestingModule({
      providers: [
        AnclajeService,
        { provide: getRepositoryToken(DocumentChunk), useValue: fragmentos },
        { provide: EmbeddingsService, useValue: embeddings },
        { provide: BusquedaLexicaService, useValue: lexica },
        FragmentacionService,
        MuestreoService,
      ],
    }).compile();

    servicio = modulo.get(AnclajeService);
  });

  const indexado = (vectores: number[][]) =>
    fragmentos.find.mockResolvedValue(
      vectores.map((embedding, i) => ({
        id: `c${i}`,
        pagina: i + 1,
        texto: `fragmento ${i}`,
        embedding,
      })) as DocumentChunk[],
    );

  describe('verificar', () => {
    it('no verifica la valla del bloque mapa, sí lo que hay dentro', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([EJE_Y]);

      const respuesta = [
        '```mapa',
        'El principito',
        '- Baobabs: hay que arrancarlos temprano del planeta (pág. 10)',
        '```',
      ].join('\n');

      const r = await servicio.verificar('doc-1', respuesta);

      const analizadas = embeddings.embeberConsultas.mock.calls[0][0] as string[];

      expect(analizadas.some((frase) => frase.includes('```'))).toBe(false);
      expect(analizadas.some((frase) => frase.startsWith('mapa'))).toBe(false);
      expect(analizadas).toContain(
        'Baobabs: hay que arrancarlos temprano del planeta (pág. 10)',
      );
      expect(r.groundingScore).not.toBeNull();
    });

    it('marca como no anclada una afirmación que no se parece al libro', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([EJE_Y]);

      const r = await servicio.verificar('doc-1', 'Esta afirmación no está en el libro.');

      expect(r.groundingScore).toBeCloseTo(0, 3);
      expect(r.flaggedClaims).toHaveLength(1);
    });

    it('no marca una afirmación que sí está en el libro', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar('doc-1', 'Esta afirmación sí está en el libro.');

      expect(r.groundingScore).toBeGreaterThan(0.86);
      expect(r.flaggedClaims).toHaveLength(0);
    });

    it('cita la página del fragmento más parecido', async () => {
      indexado([EJE_Y, EJE_X, EJE_Y]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar('doc-1', 'Una afirmación cualquiera del libro.');

      expect(r.citations[0].page).toBe(2);
    });

    it('evalúa cada oración por separado', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X, EJE_Y]);

      const r = await servicio.verificar(
        'doc-1',
        'La primera frase sí está en el libro. La segunda me la acabo de inventar.',
      );

      expect(r.citations).toHaveLength(2);
      expect(r.flaggedClaims).toEqual([
        'La segunda me la acabo de inventar.',
      ]);
    });

    it('no castiga un rechazo correcto', async () => {
      indexado([EJE_X]);

      const r = await servicio.verificar(
        'doc-1',
        'Eso no aparece en este libro. Puedes revisar este dato en el Capítulo 3.',
      );

      expect(r.groundingScore).toBeNull();
      expect(r.flaggedClaims).toHaveLength(0);
      expect(embeddings.embeberConsultas).not.toHaveBeenCalled();
    });

    it('separa las frases meta de las afirmaciones reales', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar(
        'doc-1',
        'La célula es la unidad básica de los seres vivos. Puedes revisarlo en el capítulo 2.',
      );

      expect(r.citations).toHaveLength(1);
      expect(r.citations[0].claim).toContain('célula');
    });

    it('limpia el Markdown antes de citar', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar(
        'doc-1',
        '### 1. Los agentes\n\n---\n\n* **Agentes tradicionales:** son programas con reglas fijas.',
      );

      expect(r.citations).toHaveLength(1);
      const cita = r.citations[0].claim;
      expect(cita).not.toMatch(/[#*`]|---/);
      expect(cita).toContain('Agentes tradicionales');
    });

    it('no parte las abreviaturas', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar(
        'doc-1',
        'La obra se ambienta en el París de 1924 (págs. 9-20) según la primera parte.',
      );

      expect(r.citations).toHaveLength(1);
      expect(r.citations[0].claim).toContain('9-20');
    });

    it('sin índice devuelve 0, no 1', async () => {
      indexado([]);

      const r = await servicio.verificar('doc-1', 'Cualquier afirmación sobre el libro.');

      expect(r.groundingScore).toBe(0);
      expect(r.flaggedClaims).toHaveLength(1);
      expect(embeddings.embeberConsultas).not.toHaveBeenCalled();
    });

    it('descarta fragmentos de respuesta demasiado cortos', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X]);

      const r = await servicio.verificar(
        'doc-1',
        'Claro. Mira: la fotosíntesis convierte la luz del sol en alimento.',
      );

      expect(r.citations).toHaveLength(1);
    });
  });

  describe('indexar', () => {
    it('guarda un fragmento por trozo y devuelve la huella del documento', async () => {
      embeddings.embeberPasajes.mockResolvedValue([EJE_X, EJE_Y]);

      const huella = await servicio.indexar('doc-1', [
        { pagina: 1, texto: Array.from({ length: 120 }, (_, i) => `pa${i}`).join(' ') },
        { pagina: 2, texto: Array.from({ length: 120 }, (_, i) => `pb${i}`).join(' ') },
      ]);

      expect(fragmentos.save).toHaveBeenCalled();
      expect(huella).toHaveLength(3);
      expect(Math.hypot(...huella)).toBeCloseTo(1, 5);
    });

    it('no guarda nada si el libro no dio fragmentos', async () => {
      const huella = await servicio.indexar('doc-1', [{ pagina: 1, texto: '' }]);

      expect(huella).toEqual([]);
      expect(fragmentos.save).not.toHaveBeenCalled();
    });
  });

  describe('anclarItems', () => {
    it('devuelve null cuando el libro no tiene índice', async () => {
      indexado([]);

      const citas = await servicio.anclarItems('doc-1', ['¿Qué es la célula? Su unidad básica.']);

      expect(citas).toBeNull();
      expect(embeddings.embeberConsultas).not.toHaveBeenCalled();
    });

    it('ancla cada ítem entero aunque tenga varias oraciones', async () => {
      indexado([EJE_X, EJE_Y]);
      embeddings.embeberConsultas.mockResolvedValue([CASI_X, EJE_Y]);

      const textos = [
        '¿Qué es la célula? Es la unidad básica de la vida. Tiene membrana.',
        'Cosa corta.',
      ];

      const citas = await servicio.anclarItems('doc-1', textos);

      // Ni se parte por oraciones ni se descartan los cortos: un ítem es una cita.
      expect(embeddings.embeberConsultas).toHaveBeenCalledWith(textos);
      expect(citas).toHaveLength(2);
      expect(citas?.[0]).toMatchObject({ claim: textos[0], page: 1 });
      expect(citas?.[1]).toMatchObject({ claim: textos[1], page: 2 });
      expect(citas?.[0].score).toBeCloseTo(0.97, 3);
      expect(citas?.[1].score).toBeCloseTo(1, 3);
    });
  });

  describe('representativos', () => {
    it('no devuelve nada si el libro no tiene fragmentos', async () => {
      indexado([]);

      expect(await servicio.representativos('doc-1', 40_000)).toEqual([]);
    });

    it('reparte la muestra por el libro y la devuelve en orden de lectura', async () => {
      indexado([EJE_X, CASI_X, EJE_Y]);

      // Caben dos de "fragmento N" (11 caracteres cada uno).
      const pasajes = await servicio.representativos('doc-1', 25);

      // Por relevancia sola saldrían las páginas 1 y 2; MMR cambia una por la 3.
      expect(pasajes.map((p) => p.pagina)).toEqual([2, 3]);
      expect(pasajes[0].texto).toBe('fragmento 1');
      expect(embeddings.embeberConsultas).not.toHaveBeenCalled();
    });
  });

  describe('recuperar', () => {
    it('devuelve los pasajes más parecidos, de mayor a menor', async () => {
      indexado([EJE_Y, EJE_X, CASI_X]);
      embeddings.embeberConsultas.mockResolvedValue([EJE_X]);

      const pasajes = await servicio.recuperar('doc-1', '¿De qué habla el libro?', 2);

      expect(pasajes).toHaveLength(2);
      expect(pasajes[0].score).toBeGreaterThanOrEqual(pasajes[1].score);
      expect(pasajes[0].pagina).toBe(2);
      expect(pasajes.every((p) => !p.lexico)).toBe(true);
    });

    it('sube un pasaje poco parecido si contiene las palabras de la pregunta', async () => {
      // c0 es ortogonal a la pregunta, pero la búsqueda léxica lo encuentra.
      indexado([EJE_Y, EJE_X, CASI_X]);
      embeddings.embeberConsultas.mockResolvedValue([EJE_X]);
      lexica.enDocumento.mockResolvedValue(['c0']);

      const pasajes = await servicio.recuperar('doc-1', 'Walther Flemming', 2);

      expect(pasajes.map((p) => p.pagina)).toEqual([1, 2]);
      expect(pasajes[0].lexico).toBe(true);
      // El score sigue siendo el coseno, no el puntaje fusionado.
      expect(pasajes[0].score).toBeCloseTo(0, 3);
    });

    it('no devuelve el embedding ni el id al que llama', async () => {
      indexado([EJE_X]);
      embeddings.embeberConsultas.mockResolvedValue([EJE_X]);

      const [pasaje] = await servicio.recuperar('doc-1', 'pregunta', 1);

      expect(pasaje).toEqual({ pagina: 1, texto: 'fragmento 0', score: 1, lexico: false });
    });
  });
});
