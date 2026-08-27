export enum EstiloEstudio {
  Visual = 'visual',
  Practico = 'practico',
  Lectura = 'lectura',
  Mixto = 'mixto',
}

export enum DuracionSesion {
  Corta = 'corta',
  Media = 'media',
  Larga = 'larga',
}

export enum ObjetivoEstudio {
  Comprender = 'comprender',
  Memorizar = 'memorizar',
  Examen = 'examen',
  Repasar = 'repasar',
}

export enum RitmoEstudio {
  Tranquilo = 'tranquilo',
  Equilibrado = 'equilibrado',
  Intensivo = 'intensivo',
}

export interface PreferenciasEstudio {
  estilo: EstiloEstudio;
  duracion: DuracionSesion;
  objetivo: ObjetivoEstudio;
  ritmo: RitmoEstudio;
}
