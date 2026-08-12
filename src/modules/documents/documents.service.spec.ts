import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AnclajeService } from '../anclaje/anclaje.service';
import { Materia } from '../../common/enums/materia.enum';
import { Nivel } from '../../common/enums/nivel.enum';
import { TipoDocumento } from '../../common/enums/tipo-documento.enum';
import { MlService } from '../ml/ml.service';
import { Document } from './entities/document.entity';
import { DocumentsService } from './documents.service';
import { ExtraccionService } from './services/extraccion.service';

function crearRepositorioFalso() {
  return {
    find: jest.fn<Promise<Document[]>, [unknown]>(),
    findOne: jest.fn<Promise<Document | null>, [unknown]>(),
    create: jest.fn((datos: Partial<Document>) => datos as Document),
    save: jest.fn(
      async (documento: Partial<Document>) => ({ id: 'doc-1', ...documento }) as Document,
    ),
  };
}

describe('DocumentsService', () => {
  let servicio: DocumentsService;
  let documentos: ReturnType<typeof crearRepositorioFalso>;
  let extraccion: { extraer: jest.Mock };
  let ml: { clasificar: jest.Mock };
  let anclaje: { indexar: jest.Mock };

  const archivoFalso = {
    originalname: 'Ciencias_Naturales_6to.pdf',
    buffer: Buffer.from('%PDF-falso'),
  } as Express.Multer.File;

  beforeEach(async () => {
    documentos = crearRepositorioFalso();
    extraccion = {
      extraer: jest.fn().mockResolvedValue({
        paginas: [{ pagina: 1, texto: 'contenido' }],
        textoCompleto: 'La célula es la unidad básica de los seres vivos.',
        totalPaginas: 210,
      }),
    };
    ml = { clasificar: jest.fn() };
    anclaje = { indexar: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) };

    const modulo = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getRepositoryToken(Document), useValue: documentos },
        { provide: ExtraccionService, useValue: extraccion },
        { provide: MlService, useValue: ml },
        { provide: AnclajeService, useValue: anclaje },
      ],
    }).compile();

    servicio = modulo.get(DocumentsService);
  });

  describe('aislamiento por usuario', () => {
    it('filtra por userId dentro del WHERE, no después de leer', async () => {
      documentos.findOne.mockResolvedValue(null);

      await expect(servicio.obtener('usuario-a', 'doc-de-otro')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(documentos.findOne).toHaveBeenCalledWith({
        where: { id: 'doc-de-otro', userId: 'usuario-a' },
      });
    });

    it('devuelve 404 y no 403 ante un documento ajeno', async () => {
      documentos.findOne.mockResolvedValue(null);

      const error = await servicio
        .obtener('usuario-a', 'doc-de-otro')
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('subir', () => {
    it('guarda la materia y el nivel que devuelve el clasificador', async () => {
      ml.clasificar.mockResolvedValue({
        materia: Materia.CienciasNaturales,
        nivel: Nivel.PrimariaAlta,
        confidence: 0.91,
        featureImportance: [{ feature: 'palabra:célula', contribucion: 1.2, valor: 0.4 }],
      });

      await servicio.subir('usuario-a', archivoFalso);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usuario-a',
          type: TipoDocumento.PDF,
          pages: 210,
          materia: Materia.CienciasNaturales,
          nivel: Nivel.PrimariaAlta,
          classifierConfidence: 0.91,
        }),
      );
    });

    it('guarda el documento aunque el clasificador esté caído', async () => {
      ml.clasificar.mockResolvedValue(null);

      const documento = await servicio.subir('usuario-a', archivoFalso);

      expect(documento).toBeDefined();
      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ materia: null, nivel: null }),
      );
    });

    it('deriva un título legible del nombre del archivo', async () => {
      ml.clasificar.mockResolvedValue(null);

      await servicio.subir('usuario-a', archivoFalso);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ciencias Naturales 6to' }),
      );
    });

    it('repara los acentos del nombre del archivo', async () => {
      ml.clasificar.mockResolvedValue(null);
      const nombreMalDecodificado = Buffer.from(
        'Agentes Autónomos.pdf',
        'utf8',
      ).toString('latin1');

      await servicio.subir('usuario-a', {
        ...archivoFalso,
        originalname: nombreMalDecodificado,
      } as Express.Multer.File);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Agentes Autónomos' }),
      );
    });

    it('no toca los nombres que ya están bien', async () => {
      ml.clasificar.mockResolvedValue(null);

      await servicio.subir('usuario-a', {
        ...archivoFalso,
        originalname: 'Ciencias_Naturales_6to.pdf',
      } as Express.Multer.File);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ciencias Naturales 6to' }),
      );
    });

    it('rechaza formatos que no sean PDF ni EPUB', async () => {
      await expect(
        servicio.subir('usuario-a', {
          ...archivoFalso,
          originalname: 'apuntes.docx',
        } as Express.Multer.File),
      ).rejects.toThrow(/PDF y EPUB/);
    });

    it('no manda el libro entero al clasificador', async () => {
      extraccion.extraer.mockResolvedValue({
        paginas: [],
        textoCompleto: 'a'.repeat(500_000),
        totalPaginas: 300,
      });
      ml.clasificar.mockResolvedValue(null);

      await servicio.subir('usuario-a', archivoFalso);

      const textoEnviado = ml.clasificar.mock.calls[0][0] as string;
      expect(textoEnviado.length).toBeLessThan(500_000);
    });
  });

  describe('comoResumen', () => {
    it('arma la etiqueta que muestra la tarjeta de la biblioteca', () => {
      const resumen = servicio.comoResumen({
        id: 'doc-1',
        materia: Materia.CienciasNaturales,
        nivel: Nivel.PrimariaAlta,
      } as Document);

      expect(resumen.etiqueta).toBe('Ciencias Naturales · Primaria alta');
    });

    it('no inventa una etiqueta cuando el documento no está clasificado', () => {
      const resumen = servicio.comoResumen({
        id: 'doc-1',
        materia: null,
        nivel: null,
      } as Document);

      expect(resumen.etiqueta).toBe('Sin clasificar');
    });

    it('ofrece los chips de acción rápida de la materia', () => {
      const resumen = servicio.comoResumen({
        id: 'doc-1',
        materia: Materia.Matematicas,
        nivel: Nivel.Basicos,
      } as Document);

      // El clasificador no solo etiqueta: configura lo que ofrece la interfaz.
      expect(resumen.accionesRapidas).toContain('Explica este problema paso a paso');
    });
  });
});
