import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { MlService } from '../ml/ml.service';

/** Estado de las tres piezas. Público a propósito. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ml: MlService,
  ) {}

  @Get()
  async estado() {
    const [baseDatos, clasificador] = await Promise.all([
      this.verificarBaseDatos(),
      this.ml.estaDisponible(),
    ]);

    return {
      status: baseDatos ? 'ok' : 'degradado',
      entorno: CONSTANTS.ENV,
      servicios: {
        baseDatos,
        // Estar caído no tumba el sistema, solo deja documentos sin materia.
        clasificador,
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
