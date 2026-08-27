import { IsEnum } from 'class-validator';

import {
  DuracionSesion,
  EstiloEstudio,
  ObjetivoEstudio,
  RitmoEstudio,
} from '../../../common/enums/preferencias-estudio.enum';

export class GuardarPreferenciasDto {
  @IsEnum(EstiloEstudio)
  estilo: EstiloEstudio;

  @IsEnum(DuracionSesion)
  duracion: DuracionSesion;

  @IsEnum(ObjetivoEstudio)
  objetivo: ObjetivoEstudio;

  @IsEnum(RitmoEstudio)
  ritmo: RitmoEstudio;
}
