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

/** Clasificar un libro tarda menos de un segundo. */
const TIMEOUT_MS = 15_000;

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
