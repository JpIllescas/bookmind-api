import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { Materia } from '../../../common/enums/materia.enum';
import { TINTE_POR_MATERIA } from '../../../common/utils/taxonomia.util';
import type { ResultadoClasificacion } from '../../ml/ml.service';
import { MlService } from '../../ml/ml.service';
import { Document } from '../entities/document.entity';

export const CARACTERES_PARA_CLASIFICAR = 200_000;

type CamposClasificacion = Pick<
  Document,
  'materia' | 'nivel' | 'classifierConfidence' | 'clasificadoCon' | 'tintColor'
> & { classifierFeatures?: ResultadoClasificacion['featureImportance'] };

/** Columnas que salen de una clasificación; las comparten la subida y la reclasificación. */
export function camposDeClasificacion(
  clasificacion: ResultadoClasificacion | null,
): CamposClasificacion {
  return {
    materia: clasificacion?.materia ?? null,
    nivel: clasificacion?.nivel ?? null,
    classifierConfidence: clasificacion?.confidence ?? null,
    classifierFeatures: clasificacion?.featureImportance ?? undefined,
    clasificadoCon: clasificacion?.entrenadoEn ?? null,
    tintColor: TINTE_POR_MATERIA[clasificacion?.materia ?? Materia.Otro],
  };
}

/** Pone al día la materia de los libros cuando el clasificador se reentrena. */
@Injectable()
export class ReclasificacionService {
  private readonly logger = new Logger(ReclasificacionService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentos: Repository<Document>,
    private readonly ml: MlService,
  ) {}

  /** Devuelve cuántos libros reclasificó; sin ml-service no toca nada. */
  async ponerAlDia(): Promise<number> {
    const salud = await this.ml.salud();
    const modelo = salud?.modelo_cargado ? salud.entrenado_en : null;
    if (!modelo) {
      this.logger.warn('El clasificador no responde: la materia de los libros se revisará en el próximo arranque.');
      return 0;
    }

    // Solo los ids: el texto pesa MB y se lee de a un libro.
    const desactualizados = await this.documentos.find({
      select: { id: true },
      where: [
        { processingStatus: 'ready', textLayer: 'ok', clasificadoCon: IsNull() },
        { processingStatus: 'ready', textLayer: 'ok', clasificadoCon: Not(modelo) },
      ],
    });

    let hechos = 0;
    for (const { id } of desactualizados) {
      const documento = await this.documentos.findOne({
        where: { id },
        select: { id: true, extractedText: true },
      });
      if (!documento?.extractedText) continue;

      const clasificacion = await this.ml.clasificar(
        documento.extractedText.slice(0, CARACTERES_PARA_CLASIFICAR),
      );
      // Un fallo suelto (p. ej. texto muy corto) no frena al resto; se reintenta en otro arranque.
      if (!clasificacion) continue;

      await this.documentos.update(id, {
        ...camposDeClasificacion(clasificacion),
        clasificadoCon: clasificacion.entrenadoEn ?? modelo,
      });
      hechos += 1;
    }

    if (hechos > 0) {
      this.logger.log(`Se reclasificaron ${hechos} libro(s) con el modelo entrenado el ${modelo}.`);
    }
    return hechos;
  }
}
