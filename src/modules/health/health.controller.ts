import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { AlmacenamientoService } from '../documents/services/almacenamiento.service';
import { MlService } from '../ml/ml.service';

/** Estado de las piezas. Público a propósito: no expone secretos, solo qué funciona. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ml: MlService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  @Get()
  async estado() {
    const [baseDatos, ml] = await Promise.all([this.verificarBaseDatos(), this.ml.salud()]);
    const almacenamiento = this.almacenamiento.estado();

    return {
      // Sin ml-service el sistema sigue (Studio cae a Gemini, libros sin materia), pero no está completo.
      status: baseDatos && almacenamiento.configurado && ml ? 'ok' : 'degradado',
      entorno: CONSTANTS.ENV,
      servicios: {
        baseDatos,
        almacenamiento,
        mlService: ml !== null,
        clasificador: {
          disponible: ml?.modelo_cargado ?? false,
          // Un modelo de demo no debe presentarse con métricas reales.
          demo: ml?.modelo_demo ?? null,
          entrenadoEn: ml?.entrenado_en ?? null,
        },
        ocr: {
          habilitado: CONSTANTS.OCR_ENABLED,
          tesseract: ml?.tesseract_instalado ?? false,
          idiomaEspanol: ml?.ocr_idioma_disponible ?? false,
        },
      },
      motorConversacional: {
        proveedor: CONSTANTS.LLM_PROVIDER,
        simulado: CONSTANTS.LLM_PROVIDER === 'mock',
      },
    };
  }

  private async verificarBaseDatos(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
