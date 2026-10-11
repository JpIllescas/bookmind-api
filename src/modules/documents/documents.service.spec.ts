import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AnclajeService } from '../anclaje/anclaje.service';
import { CONSTANTS } from '../../common/configuration/constants';
import { Materia } from '../../common/enums/materia.enum';
import { Nivel } from '../../common/enums/nivel.enum';
import { TipoDocumento } from '../../common/enums/tipo-documento.enum';
import { MlService } from '../ml/ml.service';
import { Document } from './entities/document.entity';
import { DocumentsService } from './documents.service';
import { AlmacenamientoService } from './services/almacenamiento.service';
import { CapitulosService } from './services/capitulos.service';
import { ExtraccionService, type PaginaExtraida } from './services/extraccion.service';
import { MENSAJES_OCR, OcrFallidoError, OcrService } from './services/ocr.service';

function crearRepositorioFalso() {
  return {
    find: jest.fn<Promise<Document[]>, [unknown]>(),
    findOne: jest.fn<Promise<Document | null>, [unknown]>(),
    update: jest.fn(),
    create: jest.fn((datos: Partial<Document>) => datos as Document),
    save: jest.fn(
      async (documento: Partial<Document>) => ({ id: 'doc-1', ...documento }) as Document,
    ),
  };
}

/** El procesamiento arranca fuera del request; esto espera a que termine. */
async function esperarProcesamiento(): Promise<void> {
  // El OCR suma varios await al flujo: se dan vueltas de sobra al event loop.
  for (let vuelta = 0; vuelta < 10; vuelta += 1) {
    await new Promise((listo) => setImmediate(listo));
  }
}

const TEXTO_NATIVO = 'La célula es la unidad básica de los seres vivos y realiza la nutrición. '.repeat(10).trim();

describe('DocumentsService', () => {
  let servicio: DocumentsService;
  let documentos: ReturnType<typeof crearRepositorioFalso>;
  let extraccion: { extraer: jest.Mock; consolidar: jest.Mock };
  let ocr: { digitalizar: jest.Mock };
  let ml: { clasificar: jest.Mock };
  let anclaje: { indexar: jest.Mock };
  let almacenamiento: {
    guardarDefinitivo: jest.Mock;
    leer: jest.Mock;
    eliminar: jest.Mock;
    prepararCarpetas: jest.Mock;
  };

  const archivoFalso = {
    originalname: 'Ciencias_Naturales_6to.pdf',
    path: '/tmp/subidas/abc.subida',
    size: 1024,
  } as Express.Multer.File;

  beforeEach(async () => {
    documentos = crearRepositorioFalso();
    const extraccionReal = new ExtraccionService();
    extraccion = {
      extraer: jest.fn().mockResolvedValue({
        paginas: [{ pagina: 1, texto: TEXTO_NATIVO }],
        textoCompleto: TEXTO_NATIVO,
        totalPaginas: 210,
        capaTexto: 'ok',
        capitulos: [],
      }),
      consolidar: jest.fn((paginas: PaginaExtraida[]) => extraccionReal.consolidar(paginas)),
    };
    ocr = { digitalizar: jest.fn().mockResolvedValue([]) };
    ml = { clasificar: jest.fn().mockResolvedValue(null) };
    anclaje = { indexar: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    almacenamiento = {
      guardarDefinitivo: jest.fn().mockResolvedValue('usuario-a/doc-1.pdf'),
      leer: jest.fn().mockResolvedValue(Buffer.from('%PDF-falso')),
      eliminar: jest.fn().mockResolvedValue(undefined),
      prepararCarpetas: jest.fn().mockResolvedValue(undefined),
    };

    const modulo = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getRepositoryToken(Document), useValue: documentos },
        { provide: ExtraccionService, useValue: extraccion },
        { provide: MlService, useValue: ml },
        { provide: AnclajeService, useValue: anclaje },
        { provide: AlmacenamientoService, useValue: almacenamiento },
        { provide: OcrService, useValue: ocr },
        {
          provide: CapitulosService,
          useValue: { guardar: jest.fn().mockResolvedValue([]), listar: jest.fn() },
        },
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

  describe('encolar', () => {
    it('responde en cuanto guarda el archivo, sin esperar la extracción', async () => {
      const documento = await servicio.encolar('usuario-a', archivoFalso);

      expect(documento.processingStatus).toBe('pending');
      expect(extraccion.extraer).not.toHaveBeenCalled();

      await esperarProcesamiento();
    });

    it('conserva el archivo original para que el visor pueda abrirlo', async () => {
      await servicio.encolar('usuario-a', archivoFalso);

      expect(almacenamiento.guardarDefinitivo).toHaveBeenCalledWith(
        archivoFalso.path,
        'usuario-a',
        'doc-1',
        TipoDocumento.PDF,
      );
      expect(documentos.update).toHaveBeenCalledWith('doc-1', {
        storagePath: 'usuario-a/doc-1.pdf',
      });

      await esperarProcesamiento();
    });

    it('guarda la materia y el nivel que devuelve el clasificador', async () => {
      ml.clasificar.mockResolvedValue({
        materia: Materia.CienciasNaturales,
        nivel: Nivel.PrimariaAlta,
        confidence: 0.91,
        featureImportance: [{ feature: 'palabra:célula', contribucion: 1.2, valor: 0.4 }],
      });

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          pages: 210,
          materia: Materia.CienciasNaturales,
          nivel: Nivel.PrimariaAlta,
          classifierConfidence: 0.91,
        }),
      );
      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'ready' }),
      );
    });

    it('marca ready solo después de indexar los fragmentos', async () => {
      let listoAlIndexar = false;

      anclaje.indexar.mockImplementation(async () => {
        listoAlIndexar = documentos.update.mock.calls.some(
          ([, cambios]) => (cambios as Partial<Document>).processingStatus === 'ready',
        );
        return [0.1, 0.2, 0.3];
      });

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      // Mientras se indexa, el estudiante no debe poder preguntar contra un índice vacío.
      expect(listoAlIndexar).toBe(false);
      expect(documentos.update).toHaveBeenLastCalledWith('doc-1', {
        processingStatus: 'ready',
        docEmbedding: [0.1, 0.2, 0.3],
      });
    });

    it('marca el documento como fallido si la indexación revienta', async () => {
      anclaje.indexar.mockRejectedValue(new Error('modelo de embeddings no disponible'));

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(documentos.update).not.toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'ready' }),
      );
      expect(documentos.update).toHaveBeenLastCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'failed' }),
      );
    });

    it('deja el documento listo aunque el clasificador esté caído', async () => {
      ml.clasificar.mockResolvedValue(null);

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ materia: null, nivel: null }),
      );
      expect(documentos.update).toHaveBeenLastCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'ready' }),
      );
    });

    it('con el OCR desactivado, marca el escaneo como sin_texto en vez de rechazarlo', async () => {
      CONSTANTS.OCR_ENABLED = false;
      extraccion.extraer.mockResolvedValue({
        paginas: [{ pagina: 1, texto: '' }],
        textoCompleto: '',
        totalPaginas: 40,
        capaTexto: 'sin_texto',
        capitulos: [],
      });

      try {
        await servicio.encolar('usuario-a', archivoFalso);
        await esperarProcesamiento();
      } finally {
        CONSTANTS.OCR_ENABLED = true;
      }

      expect(ocr.digitalizar).not.toHaveBeenCalled();

      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ textLayer: 'sin_texto', processingStatus: 'ready' }),
      );
      // Sin texto no hay nada que clasificar ni que indexar para el anclaje.
      expect(ml.clasificar).not.toHaveBeenCalled();
      expect(anclaje.indexar).not.toHaveBeenCalled();
    });

    it('deriva un título legible del nombre del archivo', async () => {
      await servicio.encolar('usuario-a', archivoFalso);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Ciencias Naturales 6to' }),
      );

      await esperarProcesamiento();
    });

    it('repara los acentos del nombre del archivo', async () => {
      const nombreMalDecodificado = Buffer.from(
        'Agentes Autónomos.pdf',
        'utf8',
      ).toString('latin1');

      await servicio.encolar('usuario-a', {
        ...archivoFalso,
        originalname: nombreMalDecodificado,
      } as Express.Multer.File);

      expect(documentos.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Agentes Autónomos' }),
      );

      await esperarProcesamiento();
    });

    it('rechaza formatos que no sean PDF ni EPUB y borra lo subido', async () => {
      await expect(
        servicio.encolar('usuario-a', {
          ...archivoFalso,
          originalname: 'apuntes.docx',
        } as Express.Multer.File),
      ).rejects.toThrow(/PDF y EPUB/);

      expect(almacenamiento.eliminar).toHaveBeenCalledWith(archivoFalso.path);
    });

    it('no manda el libro entero al clasificador', async () => {
      extraccion.extraer.mockResolvedValue({
        paginas: [],
        textoCompleto: 'a'.repeat(500_000),
        totalPaginas: 300,
        capaTexto: 'ok',
        capitulos: [],
      });

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      const textoEnviado = ml.clasificar.mock.calls[0][0] as string;
      expect(textoEnviado.length).toBeLessThan(500_000);
    });

    it('marca el documento como fallido si la extracción revienta', async () => {
      extraccion.extraer.mockRejectedValue(new Error('PDF corrupto'));

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          processingStatus: 'failed',
          processingError: 'PDF corrupto',
        }),
      );
    });
  });

  describe('OCR por página', () => {
    const escaneo = (paginas: number) => ({
      paginas: Array.from({ length: paginas }, (_, i) => ({ pagina: i + 1, texto: '' })),
      textoCompleto: '',
      totalPaginas: paginas,
      capaTexto: 'sin_texto',
      capitulos: [],
    });

    const leida = (numero: number, confianza = 0.9) => ({
      numero,
      texto: `Página ${numero}: la fotosíntesis convierte la luz en energía química para la planta. `.repeat(10),
      confianza,
    });

    const cambios = () => documentos.update.mock.calls.map(([, c]) => c as Partial<Document>);

    it('en un PDF mixto solo digitaliza las páginas sin texto y une ambos', async () => {
      extraccion.extraer.mockResolvedValue({
        paginas: [
          { pagina: 1, texto: TEXTO_NATIVO },
          { pagina: 2, texto: '' },
          { pagina: 3, texto: TEXTO_NATIVO },
        ],
        textoCompleto: TEXTO_NATIVO,
        totalPaginas: 3,
        capaTexto: 'ok',
        capitulos: [],
      });
      ocr.digitalizar.mockResolvedValue([leida(2, 0.82)]);

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(ocr.digitalizar).toHaveBeenCalledWith('doc-1', expect.any(Buffer), [2]);
      expect(cambios()).toContainEqual({ processingStatus: 'ocr', progresoOcr: { procesadas: 0, total: 1 } });

      const indexadas = anclaje.indexar.mock.calls[0][1] as PaginaExtraida[];
      expect(indexadas.map((p) => p.confianza)).toEqual([null, 0.82, null]);
      expect(indexadas[1].texto).toContain('fotosíntesis');

      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({
          paginasOcr: 1,
          confianzaOcrMedia: 0.82,
          origenPaginas: [
            { pagina: 1, origen: 'nativo', confianza: null },
            { pagina: 2, origen: 'ocr', confianza: 0.82 },
            { pagina: 3, origen: 'nativo', confianza: null },
          ],
        }),
      );
      expect(documentos.update).toHaveBeenLastCalledWith('doc-1', expect.objectContaining({ processingStatus: 'ready' }));
    });

    it('un escaneo digitalizado se estudia como un PDF normal', async () => {
      extraccion.extraer.mockResolvedValue(escaneo(3));
      ocr.digitalizar.mockResolvedValue([leida(1), leida(2), leida(3)]);

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(ocr.digitalizar).toHaveBeenCalledWith('doc-1', expect.any(Buffer), [1, 2, 3]);
      expect(documentos.update).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ textLayer: 'ok', paginasOcr: 3, confianzaOcrMedia: 0.9 }),
      );
      expect(anclaje.indexar).toHaveBeenCalled();
      expect(documentos.update).toHaveBeenLastCalledWith('doc-1', expect.objectContaining({ processingStatus: 'ready' }));
    });

    it('si el OCR no está disponible, un escaneo falla con un mensaje para el estudiante', async () => {
      extraccion.extraer.mockResolvedValue(escaneo(2));
      ocr.digitalizar.mockRejectedValue(new OcrFallidoError(MENSAJES_OCR.noDisponible));

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(cambios().some((c) => c.processingStatus === 'ready')).toBe(false);
      expect(documentos.update).toHaveBeenLastCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'failed', processingError: MENSAJES_OCR.noDisponible }),
      );
      expect(anclaje.indexar).not.toHaveBeenCalled();
    });

    it('si el OCR no lee nada, el escaneo falla en vez de quedar listo y vacío', async () => {
      extraccion.extraer.mockResolvedValue(escaneo(2));
      ocr.digitalizar.mockResolvedValue([
        { numero: 1, texto: '', confianza: 0 },
        { numero: 2, texto: '', confianza: 0 },
      ]);

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      expect(cambios().some((c) => c.processingStatus === 'ready')).toBe(false);
      expect(documentos.update).toHaveBeenLastCalledWith(
        'doc-1',
        expect.objectContaining({ processingStatus: 'failed', processingError: MENSAJES_OCR.sinTextoLegible }),
      );
    });

    it('si el OCR falla en un libro con texto, sigue con el texto nativo', async () => {
      extraccion.extraer.mockResolvedValue({
        paginas: [{ pagina: 1, texto: TEXTO_NATIVO }, { pagina: 2, texto: 'Unidad 3' }],
        textoCompleto: TEXTO_NATIVO,
        totalPaginas: 2,
        capaTexto: 'ok',
        capitulos: [],
      });
      ocr.digitalizar.mockRejectedValue(new OcrFallidoError(MENSAJES_OCR.noDisponible));

      await servicio.encolar('usuario-a', archivoFalso);
      await esperarProcesamiento();

      const indexadas = anclaje.indexar.mock.calls[0][1] as PaginaExtraida[];
      expect(indexadas[1].texto).toBe('Unidad 3');
      expect(documentos.update).toHaveBeenCalledWith('doc-1', expect.objectContaining({ paginasOcr: 0 }));
      expect(documentos.update).toHaveBeenLastCalledWith('doc-1', expect.objectContaining({ processingStatus: 'ready' }));
    });

    it('un EPUB nunca pasa por el OCR', async () => {
      extraccion.extraer.mockResolvedValue({
        paginas: [{ pagina: 1, texto: 'Portada' }, { pagina: 2, texto: TEXTO_NATIVO }],
        textoCompleto: TEXTO_NATIVO,
        totalPaginas: 2,
        capaTexto: 'ok',
        capitulos: [],
      });

      await servicio.encolar('usuario-a', { ...archivoFalso, originalname: 'libro.epub' } as Express.Multer.File);
      await esperarProcesamiento();

      expect(ocr.digitalizar).not.toHaveBeenCalled();
    });

    it('al reiniciar retoma también los documentos que estaban en OCR', async () => {
      extraccion.extraer.mockResolvedValue(escaneo(1));
      ocr.digitalizar.mockResolvedValue([leida(1)]);
      documentos.find.mockResolvedValue([
        { id: 'doc-ocr', storagePath: 'usuario-a/doc-ocr.pdf', type: TipoDocumento.PDF, title: 'Escaneo' } as Document,
      ]);

      await servicio.onApplicationBootstrap();
      await esperarProcesamiento();

      expect(documentos.find).toHaveBeenCalledWith({
        where: expect.arrayContaining([{ processingStatus: 'ocr' }]),
      });
      expect(ocr.digitalizar).toHaveBeenCalledWith('doc-ocr', expect.any(Buffer), [1]);
      expect(documentos.update).toHaveBeenLastCalledWith('doc-ocr', expect.objectContaining({ processingStatus: 'ready' }));
    });
  });

  describe('obtenerConTexto', () => {
    const conDocumento = (documento: Partial<Document> | null) => {
      const consulta = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(documento),
      };
      (documentos as { createQueryBuilder?: jest.Mock }).createQueryBuilder = jest
        .fn()
        .mockReturnValue(consulta);
    };

    it('no entrega el texto mientras el libro se está preparando', async () => {
      conDocumento({ id: 'doc-1', processingStatus: 'processing', textLayer: 'ok' });

      await expect(servicio.obtenerConTexto('usuario-a', 'doc-1')).rejects.toThrow(
        /todavía se está preparando/,
      );
    });

    it('explica que hay que volver a subir un libro fallido', async () => {
      conDocumento({ id: 'doc-1', processingStatus: 'failed', textLayer: 'ok' });

      await expect(servicio.obtenerConTexto('usuario-a', 'doc-1')).rejects.toThrow(
        /Vuelve a subirlo/,
      );
    });

    it('entrega el texto de un libro listo', async () => {
      conDocumento({
        id: 'doc-1',
        processingStatus: 'ready',
        textLayer: 'ok',
        extractedText: 'La célula.',
      });

      const documento = await servicio.obtenerConTexto('usuario-a', 'doc-1');

      expect(documento.extractedText).toBe('La célula.');
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

    it('avisa cuando el documento no tiene archivo que abrir', () => {
      const resumen = servicio.comoResumen({
        id: 'doc-1',
        materia: null,
        nivel: null,
        storagePath: null,
      } as Document);

      expect(resumen.tieneArchivo).toBe(false);
    });
  });
});
