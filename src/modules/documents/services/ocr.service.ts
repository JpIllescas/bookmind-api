import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../../common/configuration/constants';
import {
  MlService,
  OcrNoDisponibleError,
  TrabajoOcr,
  TrabajoOcrPerdidoError,
} from '../../ml/ml.service';
import { Document } from '../entities/document.entity';
import { PaginaLeida } from './deteccion-ocr';

/** Fallo del OCR con un mensaje que se le puede mostrar tal cual al estudiante. */
export class OcrFallidoError extends Error {}

const ESPERA_INICIAL_MS = 1_000;
const ESPERA_MAXIMA_MS = 10_000;
const FACTOR_ESPERA = 1.5;

// Un reinicio del ml-service tarda unos segundos: antes de rendirse se aguantan unas consultas fallidas.
const FALLOS_DE_CONEXION_TOLERADOS = 3;

// Margen fijo para arrancar más lo que tarda una página a 300 dpi en un equipo modesto.
const TIMEOUT_BASE_MS = 60_000;
const TIMEOUT_POR_PAGINA_MS = 15_000;

export const MENSAJES_OCR = {
  noDisponible:
    'Este libro tiene páginas escaneadas como imagen y ahora mismo no podemos digitalizarlas. ' +
    'Vuelve a subirlo en un rato; si sigue pasando, avisa a quien administra BookMind.',
  demasiadasPaginas: (paginas: number, maximo: number) =>
    `Este libro tiene ${paginas} páginas escaneadas y el máximo que podemos digitalizar es ${maximo}. ` +
    'Divide el PDF en partes más pequeñas y súbelas por separado.',
  tardoDemasiado:
    'La digitalización del libro tardó demasiado y se detuvo. Vuelve a subirlo; ' +
    'si es muy grande, prueba a dividirlo en partes.',
  fallo:
    'No pudimos digitalizar algunas páginas del libro. Vuelve a subirlo; ' +
    'si vuelve a fallar, prueba con un escaneo más nítido.',
  sinTextoLegible:
    'No encontramos texto legible en las imágenes de este libro. ' +
    'Prueba con un escaneo más nítido, derecho y con buena luz.',
};

/** Orquesta un trabajo de OCR del ml-service: lo crea, sigue su avance y lo guarda en el documento. */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  // Propiedades y no funciones sueltas: los tests las reemplazan para no esperar de verdad.
  dormir = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));
  ahora = () => Date.now();

  constructor(
    private readonly ml: MlService,
    @InjectRepository(Document) private readonly documentos: Repository<Document>,
  ) {}

  async digitalizar(documentId: string, pdf: Buffer, paginas: number[]): Promise<PaginaLeida[]> {
    if (paginas.length > CONSTANTS.OCR_MAX_PAGINAS) {
      throw new OcrFallidoError(MENSAJES_OCR.demasiadasPaginas(paginas.length, CONSTANTS.OCR_MAX_PAGINAS));
    }

    try {
      return await this.seguir(documentId, await this.ml.crearTrabajoOcr(pdf, paginas), paginas.length);
    } catch (error) {
      // El ml-service se reinició a mitad: se relanza una vez con el mismo PDF.
      if (!(error instanceof TrabajoOcrPerdidoError)) throw this.traducir(error);

      this.logger.warn(`Documento ${documentId}: el ml-service perdió el trabajo de OCR; se relanza.`);
      try {
        return await this.seguir(documentId, await this.ml.crearTrabajoOcr(pdf, paginas), paginas.length);
      } catch (otro) {
        throw this.traducir(otro);
      }
    }
  }

  private async seguir(documentId: string, id: string, total: number): Promise<PaginaLeida[]> {
    const limite = this.ahora() + TIMEOUT_BASE_MS + total * TIMEOUT_POR_PAGINA_MS;
    let espera = ESPERA_INICIAL_MS;
    let ultimoAvance = -1;
    let fallosSeguidos = 0;

    for (;;) {
      await this.dormir(espera);

      let trabajo: TrabajoOcr;
      try {
        trabajo = await this.ml.consultarTrabajoOcr(id);
        fallosSeguidos = 0;
      } catch (error) {
        if (!(error instanceof OcrNoDisponibleError) || ++fallosSeguidos > FALLOS_DE_CONEXION_TOLERADOS) throw error;
        espera = Math.min(espera * FACTOR_ESPERA, ESPERA_MAXIMA_MS);
        continue;
      }

      if (trabajo.procesadas !== ultimoAvance) {
        ultimoAvance = trabajo.procesadas;
        await this.documentos.update(documentId, {
          progresoOcr: { procesadas: trabajo.procesadas, total: trabajo.total },
        });
        // Mientras avanza, se consulta seguido; el backoff es para cuando está atascado.
        espera = ESPERA_INICIAL_MS;
      } else {
        espera = Math.min(espera * FACTOR_ESPERA, ESPERA_MAXIMA_MS);
      }

      if (trabajo.estado === 'listo') {
        await this.ml.cancelarTrabajoOcr(id);
        return trabajo.paginas ?? [];
      }

      if (trabajo.estado === 'error') {
        this.logger.error(`Documento ${documentId}: el OCR falló en el ml-service: ${trabajo.error}`);
        throw new OcrFallidoError(MENSAJES_OCR.fallo);
      }

      if (this.ahora() > limite) {
        await this.ml.cancelarTrabajoOcr(id);
        this.logger.error(`Documento ${documentId}: el OCR superó el tiempo máximo (${total} páginas).`);
        throw new OcrFallidoError(MENSAJES_OCR.tardoDemasiado);
      }
    }
  }

  private traducir(error: unknown): Error {
    if (error instanceof OcrFallidoError) return error;

    this.logger.error(`OCR no disponible: ${error instanceof Error ? error.message : String(error)}`);
    return new OcrFallidoError(
      error instanceof OcrNoDisponibleError || error instanceof TrabajoOcrPerdidoError
        ? MENSAJES_OCR.noDisponible
        : MENSAJES_OCR.fallo,
    );
  }
}
