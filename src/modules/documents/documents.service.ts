import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Materia } from '../../common/enums/materia.enum';
import { TipoDocumento } from '../../common/enums/tipo-documento.enum';
import {
  ACCIONES_POR_MATERIA,
  TINTE_POR_MATERIA,
  etiquetaLegible,
} from '../../common/utils/taxonomia.util';
import { AnclajeService } from '../anclaje/anclaje.service';
import { MlService } from '../ml/ml.service';
import { Document } from './entities/document.entity';
import {
  AlmacenamientoService,
  MIME_POR_TIPO,
  type ArchivoAbierto,
} from './services/almacenamiento.service';
import { ExtraccionService } from './services/extraccion.service';

const CARACTERES_PARA_CLASIFICAR = 200_000;

@Injectable()
export class DocumentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentos: Repository<Document>,
    private readonly extraccion: ExtraccionService,
    private readonly ml: MlService,
    private readonly anclaje: AnclajeService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** Guarda el archivo y deja el trabajo pesado fuera del request. */
  async encolar(userId: string, archivo: Express.Multer.File): Promise<Document> {
    let tipo: TipoDocumento;

    try {
      tipo = this.detectarTipo(archivo);
    } catch (error) {
      // El archivo ya está en disco cuando se valida la extensión.
      await this.almacenamiento.eliminar(archivo.path);
      throw error;
    }

    const documento = await this.documentos.save(
      this.documentos.create({
        userId,
        title: this.titulaDesdeNombre(archivo.originalname),
        author: null,
        type: tipo,
        pages: 0,
        extractedText: '',
        docEmbedding: [],
        storagePath: null,
        fileSize: archivo.size,
        textLayer: 'ok',
        materia: null,
        nivel: null,
        classifierConfidence: null,
        classifierFeatures: null,
        tintColor: this.elegirTinte(null),
        progress: 0,
        processingStatus: 'pending',
        processingError: null,
      }),
    );

    documento.storagePath = await this.almacenamiento.guardarDefinitivo(
      archivo.path,
      userId,
      documento.id,
      tipo,
    );

    await this.documentos.update(documento.id, {
      storagePath: documento.storagePath,
    });

    void this.procesarEnSegundoPlano(documento);

    return documento;
  }

  /** Abre el archivo original para el visor, opcionalmente por rangos. */
  async abrirArchivo(
    userId: string,
    id: string,
    cabeceraRango?: string,
  ): Promise<ArchivoAbierto & { mime: string }> {
    const documento = await this.obtener(userId, id);

    if (!documento.storagePath) {
      throw new NotFoundException(
        'Este documento se subió antes de que se guardara el archivo original. ' +
          'Vuelve a subirlo para poder verlo.',
      );
    }

    // El tamaño real manda: file_size puede faltar en documentos antiguos.
    const tamano = await this.almacenamiento.tamano(documento.storagePath);
    const rango = this.almacenamiento.interpretarRango(cabeceraRango, tamano);
    const archivo = await this.almacenamiento.abrir(documento.storagePath, rango);

    return { ...archivo, mime: MIME_POR_TIPO[documento.type] };
  }

  private async procesarEnSegundoPlano(documento: Document): Promise<void> {
    await this.documentos.update(documento.id, { processingStatus: 'processing' });

    try {
      const buffer = await this.almacenamiento.leer(documento.storagePath!);

      const { paginas, textoCompleto, totalPaginas, capaTexto } =
        await this.extraccion.extraer(buffer, documento.type);

      // Un escaneo se puede leer en el visor, pero no hay texto que clasificar ni indexar.
      if (capaTexto === 'sin_texto') {
        await this.documentos.update(documento.id, {
          pages: totalPaginas,
          extractedText: textoCompleto,
          textLayer: 'sin_texto',
          processingStatus: 'ready',
        });

        return;
      }

      const clasificacion = await this.ml.clasificar(
        textoCompleto.slice(0, CARACTERES_PARA_CLASIFICAR),
      );

      if (!clasificacion) {
        this.logger.warn(
          `El documento "${documento.title}" se guarda sin clasificar.`,
        );
      }

      await this.documentos.update(documento.id, {
        pages: totalPaginas,
        extractedText: textoCompleto,
        textLayer: 'ok',
        materia: clasificacion?.materia ?? null,
        nivel: clasificacion?.nivel ?? null,
        classifierConfidence: clasificacion?.confidence ?? null,
        classifierFeatures: clasificacion?.featureImportance ?? undefined,
        tintColor: this.elegirTinte(clasificacion?.materia ?? null),
        processingStatus: 'ready',
      });

      const huella = await this.anclaje.indexar(documento.id, paginas);

      if (huella.length > 0) {
        await this.documentos.update(documento.id, { docEmbedding: huella });
      }
    } catch (error) {
      this.logger.error(
        `Falló el procesamiento de ${documento.id}: ${String(error)}`,
      );

      await this.documentos.update(documento.id, {
        processingStatus: 'failed',
        processingError:
          error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Retoma al arrancar los documentos que un reinicio dejó a medias. */
  async onApplicationBootstrap(): Promise<void> {
    await this.almacenamiento.prepararCarpetas();

    const pendientes = await this.documentos.find({
      where: [{ processingStatus: 'pending' }, { processingStatus: 'processing' }],
    });

    for (const documento of pendientes) {
      if (documento.storagePath) {
        void this.procesarEnSegundoPlano(documento);
        continue;
      }

      // Sin archivo no hay nada que reintentar: se subió antes de guardarlo.
      await this.documentos.update(documento.id, {
        processingStatus: 'failed',
        processingError:
          'El procesamiento se interrumpió y el archivo original no se conservó. ' +
          'Vuelve a subir el documento.',
      });
    }

    if (pendientes.length > 0) {
      this.logger.log(`Se retomaron ${pendientes.length} documento(s) a medias.`);
    }
  }

  async listar(userId: string) {
    const documentos = await this.documentos.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return documentos.map((documento) => this.comoResumen(documento));
  }

  async obtener(userId: string, id: string): Promise<Document> {
    const documento = await this.documentos.findOne({
      where: { id, userId },
    });

    if (!documento) {
      throw new NotFoundException('No se encontró el documento.');
    }

    return documento;
  }

  async obtenerConTexto(userId: string, id: string): Promise<Document> {
    const documento = await this.documentos
      .createQueryBuilder('documento')
      .addSelect('documento.extractedText')
      .where('documento.id = :id', { id })
      .andWhere('documento.user_id = :userId', { userId })
      .getOne();

    if (!documento) {
      throw new NotFoundException('No se encontró el documento.');
    }

    // El chat, los materiales y los planes necesitan texto: un escaneo no lo tiene.
    if (documento.textLayer === 'sin_texto') {
      throw new BadRequestException(
        'Este documento está escaneado como imágenes. Puedes leerlo, pero el ' +
          'asistente necesita un archivo con texto seleccionable.',
      );
    }

    return documento;
  }

  /** Borra el libro con su archivo; fragmentos, chat y materiales caen en cascada. */
  async eliminar(userId: string, id: string): Promise<void> {
    const documento = await this.obtener(userId, id);

    await this.almacenamiento.eliminar(documento.storagePath);
    await this.documentos.delete({ id, userId });

    this.logger.log(`Documento "${documento.title}" eliminado por su dueño.`);
  }

  /** Texto para mostrar en pantalla; a diferencia del chat, un escaneo no es un error. */
  async textoParaLectura(userId: string, id: string): Promise<string> {
    const documento = await this.documentos
      .createQueryBuilder('documento')
      .addSelect('documento.extractedText')
      .where('documento.id = :id', { id })
      .andWhere('documento.user_id = :userId', { userId })
      .getOne();

    if (!documento) {
      throw new NotFoundException('No se encontró el documento.');
    }

    return documento.extractedText;
  }

  /** Forma en la que el frontend consume un documento. */
  comoResumen(documento: Document) {
    const materia = documento.materia;

    return {
      id: documento.id,
      title: documento.title,
      author: documento.author,
      type: documento.type,
      pages: documento.pages,
      progress: documento.progress,
      tintColor: documento.tintColor,
      createdAt: documento.createdAt,
      materia,
      nivel: documento.nivel,
      // Etiqueta lista para la tarjeta.
      etiqueta: etiquetaLegible(materia, documento.nivel),
      classifierConfidence: documento.classifierConfidence,
      processingStatus: documento.processingStatus,
      processingError: documento.processingError,
      textLayer: documento.textLayer,
      // Sin archivo original el visor no tiene qué abrir.
      tieneArchivo: documento.storagePath !== null,
      fileSize: documento.fileSize,
      // Los chips del chat dependen de la materia.
      accionesRapidas: ACCIONES_POR_MATERIA[materia ?? Materia.Otro],
    };
  }

  private detectarTipo(archivo: Express.Multer.File): TipoDocumento {
    const nombre = archivo.originalname.toLowerCase();

    // Por extensión, no por mimetype: el cliente lo controla y miente.
    if (nombre.endsWith('.pdf')) return TipoDocumento.PDF;
    if (nombre.endsWith('.epub')) return TipoDocumento.EPUB;

    throw new BadRequestException(
      'Formato no admitido. BookMind acepta PDF y EPUB.',
    );
  }

  private titulaDesdeNombre(nombreArchivo: string): string {
    const nombre = this.repararCodificacion(nombreArchivo);
    const sinExtension = nombre.replace(/\.(pdf|epub)$/i, '');
    const limpio = sinExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return limpio.length > 0 ? limpio.slice(0, 200) : 'Documento sin título';
  }

  private repararCodificacion(nombre: string): string {
    const reparado = Buffer.from(nombre, 'latin1').toString('utf8');

    return reparado.includes('�') ? nombre : reparado;
  }

  private elegirTinte(materia: Materia | null): string {
    return TINTE_POR_MATERIA[materia ?? Materia.Otro];
  }
}
