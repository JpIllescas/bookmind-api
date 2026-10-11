import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CONSTANTS } from '../../common/configuration/constants';
import { Materia } from '../../common/enums/materia.enum';
import { Nivel } from '../../common/enums/nivel.enum';

export interface FeatureImportancia {
  feature: string;
  contribucion: number;
  valor: number;
}

export interface ResultadoClasificacion {
  materia: Materia;
  materiaLegible: string;
  nivel: Nivel;
  nivelLegible: string;
  confidence: number;
  bajaConfianza: boolean;
  featureImportance: FeatureImportancia[];
  probabilidades: Record<string, number>;
  legibilidad: Record<string, number | string>;
}

export type EstadoTrabajoOcr = 'pendiente' | 'procesando' | 'listo' | 'error';

export interface PaginaOcr {
  numero: number;
  texto: string;
  /** Confianza media de Tesseract en la página, de 0 a 1. */
  confianza: number;
}

export interface TrabajoOcr {
  id: string;
  estado: EstadoTrabajoOcr;
  procesadas: number;
  total: number;
  error: string | null;
  /** Solo cuando `estado` es `listo`. */
  paginas?: PaginaOcr[];
}

/** El ml-service no responde o no tiene Tesseract: reintentar no sirve hasta que alguien lo arregle. */
export class OcrNoDisponibleError extends Error {}

/** El ml-service ya no conoce el trabajo: se reinició o venció su TTL. */
export class TrabajoOcrPerdidoError extends Error {}

/** Clasificar un libro tarda menos de un segundo. */
const TIMEOUT_MS = 15_000;

// Subir el PDF por la red local: margen fijo más ~1 s por MB.
const OCR_SUBIDA_BASE_MS = 30_000;
const OCR_SUBIDA_POR_MB_MS = 1_000;
const OCR_CONSULTA_MS = 5_000;

/** Generadores del motor de estudio propio, con las mismas claves que el ml-service. */
export type TipoEstudio = 'summary' | 'concepts' | 'flashcards' | 'quiz' | 'timeline';

export interface PaginaEstudio {
  pagina: number;
  texto: string;
  /** Solo en páginas digitalizadas con OCR; null es texto nativo. */
  confianza?: number | null;
}

export interface ResultadoEstudio<T = unknown> {
  tipo: TipoEstudio;
  origen: 'motor';
  items: T[];
  /** Páginas que el motor no usó por baja calidad de OCR. */
  paginasExcluidas: number;
}

/** Cliente del microservicio de clasificación (pieza 3). */
@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = CONSTANTS.ML_SERVICE_URL.replace(/\/+$/, '');
  }

  async estaDisponible(): Promise<boolean> {
    try {
      const respuesta = await this.peticion('/health', {
        method: 'GET',
        timeoutMs: 3_000,
      });
      return respuesta.ok;
    } catch {
      return false;
    }
  }

  /** Devuelve null si el servicio no responde: la subida no debe bloquearse. */
  async clasificar(texto: string): Promise<ResultadoClasificacion | null> {
    try {
      const respuesta = await this.peticion('/classify', {
        method: 'POST',
        body: JSON.stringify({ text: texto }),
        timeoutMs: TIMEOUT_MS,
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => '');
        this.logger.warn(
          `El clasificador respondió ${respuesta.status}: ${detalle.slice(0, 200)}`,
        );
        return null;
      }

      return (await respuesta.json()) as ResultadoClasificacion;
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar al clasificador en ${this.baseUrl}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'El documento se guardará sin materia.',
      );
      return null;
    }
  }

  /** Sube el PDF una sola vez; el ml-service digitaliza en segundo plano y devuelve el id. */
  async crearTrabajoOcr(pdf: Buffer, paginas: number[]): Promise<string> {
    const formulario = new FormData();
    formulario.append('archivo', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'libro.pdf');
    formulario.append('paginas', JSON.stringify(paginas));

    const megas = pdf.length / (1024 * 1024);
    let respuesta: Response;

    try {
      // Sin Content-Type a mano: fetch pone el boundary del multipart.
      respuesta = await fetch(`${this.baseUrl}/ocr/trabajos`, {
        method: 'POST',
        body: formulario,
        signal: AbortSignal.timeout(Math.ceil(OCR_SUBIDA_BASE_MS + megas * OCR_SUBIDA_POR_MB_MS)),
      });
    } catch (error) {
      throw new OcrNoDisponibleError(
        `No se pudo contactar al ml-service en ${this.baseUrl}: ${this.mensajeDe(error)}`,
      );
    }

    if (respuesta.status === 503) {
      throw new OcrNoDisponibleError(await this.detalleDe(respuesta));
    }
    if (!respuesta.ok) {
      throw new Error(`El ml-service rechazó el OCR (${respuesta.status}): ${await this.detalleDe(respuesta)}`);
    }

    return ((await respuesta.json()) as { id: string }).id;
  }

  async consultarTrabajoOcr(id: string): Promise<TrabajoOcr> {
    let respuesta: Response;

    try {
      respuesta = await this.peticion(`/ocr/trabajos/${encodeURIComponent(id)}`, {
        method: 'GET',
        timeoutMs: OCR_CONSULTA_MS,
      });
    } catch (error) {
      throw new OcrNoDisponibleError(`El ml-service dejó de responder: ${this.mensajeDe(error)}`);
    }

    if (respuesta.status === 404) {
      throw new TrabajoOcrPerdidoError(`El ml-service ya no conoce el trabajo ${id}.`);
    }
    if (!respuesta.ok) {
      throw new Error(`El ml-service respondió ${respuesta.status}: ${await this.detalleDe(respuesta)}`);
    }

    return (await respuesta.json()) as TrabajoOcr;
  }

  /** Libera el trabajo en el ml-service; si ya no existe, no hay nada que hacer. */
  async cancelarTrabajoOcr(id: string): Promise<void> {
    try {
      await this.peticion(`/ocr/trabajos/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        timeoutMs: OCR_CONSULTA_MS,
      });
    } catch (error) {
      this.logger.warn(`No se pudo cancelar el trabajo de OCR ${id}: ${this.mensajeDe(error)}`);
    }
  }

  private async detalleDe(respuesta: Response): Promise<string> {
    const texto = await respuesta.text().catch(() => '');
    try {
      const { detail } = JSON.parse(texto) as { detail?: unknown };
      if (typeof detail === 'string') return detail;
    } catch {
      // No era JSON: se devuelve tal cual.
    }
    return texto.slice(0, 300);
  }

  private mensajeDe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Material generado por el motor propio; null si el servicio no responde. */
  async estudio<T = unknown>(
    tipo: TipoEstudio,
    paginas: PaginaEstudio[],
    cantidad?: number,
  ): Promise<ResultadoEstudio<T> | null> {
    try {
      const respuesta = await this.peticion(`/study/${tipo}`, {
        method: 'POST',
        body: JSON.stringify({
          paginas,
          cantidad,
          confianzaMinima: CONSTANTS.OCR_CONFIANZA_MINIMA,
        }),
        timeoutMs: TIMEOUT_MS,
      });

      if (!respuesta.ok) {
        const detalle = await respuesta.text().catch(() => '');
        this.logger.warn(`El motor de estudio respondió ${respuesta.status}: ${detalle.slice(0, 200)}`);
        return null;
      }

      const resultado = (await respuesta.json()) as ResultadoEstudio<T>;
      return { ...resultado, paginasExcluidas: resultado.paginasExcluidas ?? 0 };
    } catch (error) {
      this.logger.warn(
        `No se pudo contactar al motor de estudio en ${this.baseUrl}: ` +
          `${error instanceof Error ? error.message : String(error)}.`,
      );
      return null;
    }
  }

  /** Reentrena el clasificador. A diferencia de clasificar, aquí sí lanza. */
  async reentrenar(): Promise<unknown> {
    const respuesta = await this.peticion('/train', {
      method: 'POST',
      timeoutMs: 120_000,
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new ServiceUnavailableException(
        `El reentrenamiento falló (${respuesta.status}): ${detalle.slice(0, 300)}`,
      );
    }

    return respuesta.json();
  }

  private async peticion(
    ruta: string,
    opciones: { method: string; body?: string; timeoutMs: number },
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${ruta}`, {
      method: opciones.method,
      headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opciones.body,
      signal: AbortSignal.timeout(opciones.timeoutMs),
    });
  }
}
