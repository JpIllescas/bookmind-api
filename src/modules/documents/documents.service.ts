import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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
import { ExtraccionService } from './services/extraccion.service';

const CARACTERES_PARA_CLASIFICAR = 200_000;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentos: Repository<Document>,
    private readonly extraccion: ExtraccionService,
    private readonly ml: MlService,
    private readonly anclaje: AnclajeService,
  ) {}

  async subir(
    userId: string,
    archivo: Express.Multer.File,
  ): Promise<Document> {
    const tipo = this.detectarTipo(archivo);

    const { paginas, textoCompleto, totalPaginas } = await this.extraccion.extraer(
      archivo.buffer,
      tipo,
    );

    // Si el ml-service está caído se guarda sin materia y se reclasifica luego.
    const clasificacion = await this.ml.clasificar(
      textoCompleto.slice(0, CARACTERES_PARA_CLASIFICAR),
    );

    if (!clasificacion) {
      this.logger.warn(
        `El documento "${archivo.originalname}" se guarda sin clasificar.`,
      );
    }

    const documento = this.documentos.create({
      userId,
      title: this.titulaDesdeNombre(archivo.originalname),
      author: null,
      type: tipo,
      pages: totalPaginas,
      extractedText: textoCompleto,
      docEmbedding: [],
      materia: clasificacion?.materia ?? null,
      nivel: clasificacion?.nivel ?? null,
      classifierConfidence: clasificacion?.confidence ?? null,
      classifierFeatures: clasificacion?.featureImportance ?? null,
      tintColor: this.elegirTinte(clasificacion?.materia ?? null),
      progress: 0,
      processingStatus: 'ready',
      processingError: null,
    });

    const guardado = await this.documentos.save(documento);

    try {
      const huella = await this.anclaje.indexar(guardado.id, paginas);
      if (huella.length > 0) {
        guardado.docEmbedding = huella;
        await this.documentos.save(guardado);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo indexar "${guardado.title}" para el anclaje: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return guardado;
  }

  /** Persiste la solicitud y deja el trabajo pesado fuera del request. */
  async encolar(userId: string, archivo: Express.Multer.File): Promise<Document> {
    const tipo = this.detectarTipo(archivo);
    const documento = await this.documentos.save(this.documentos.create({
      userId, title: this.titulaDesdeNombre(archivo.originalname), author: null,
      type: tipo, pages: 0, extractedText: '', docEmbedding: [], materia: null,
      nivel: null, classifierConfidence: null, classifierFeatures: null,
      tintColor: this.elegirTinte(null), progress: 0,
      processingStatus: 'pending', processingError: null,
    }));

    // The buffer is held only for the lifetime of this in-process job; no R2 is used.
    setImmediate(() => void this.procesarEnSegundoPlano(documento, archivo.buffer));
    return documento;
  }

  private async procesarEnSegundoPlano(documento: Document, buffer: Buffer): Promise<void> {
    await this.documentos.update(documento.id, { processingStatus: 'processing' });
    try {
      const { paginas, textoCompleto, totalPaginas } = await this.extraccion.extraer(buffer, documento.type);
      const clasificacion = await this.ml.clasificar(textoCompleto.slice(0, CARACTERES_PARA_CLASIFICAR));
      await this.documentos.update(documento.id, {
        pages: totalPaginas, extractedText: textoCompleto,
        materia: clasificacion?.materia ?? null, nivel: clasificacion?.nivel ?? null,
        classifierConfidence: clasificacion?.confidence ?? null,
        classifierFeatures: clasificacion?.featureImportance ?? undefined,
        tintColor: this.elegirTinte(clasificacion?.materia ?? null), processingStatus: 'ready',
      });
      const huella = await this.anclaje.indexar(documento.id, paginas);
      if (huella.length > 0) await this.documentos.update(documento.id, { docEmbedding: huella });
    } catch (error) {
      this.logger.error(`Falló el procesamiento de ${documento.id}: ${String(error)}`);
      await this.documentos.update(documento.id, {
        processingStatus: 'failed', processingError: error instanceof Error ? error.message : String(error),
      });
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

    return documento;
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
