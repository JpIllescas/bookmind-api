import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SOLAPE } from '../../anclaje/services/fragmentacion.service';
import { Chapter } from '../entities/chapter.entity';
import { DocumentChunk } from '../entities/document-chunk.entity';
import { CapituloDetectado, detectarCapitulos } from './deteccion-capitulos';
import { PaginaExtraida } from './extraccion.service';

/** Uno o varios capítulos seguidos: la unidad de resumen y de estudio. */
export interface TramoCapitulos {
  /** Id del primer capítulo: identifica el tramo en intentos y rutas. */
  id: string;
  titulo: string;
  paginaInicio: number;
  paginaFin: number;
  capitulos: Chapter[];
}

/** El título detectado puede traer la primera frase pegada: se queda con el nombre. */
export function nombreDeCapitulo(capitulo: Pick<Chapter, 'titulo'>): string {
  return capitulo.titulo.split(' · ')[0].trim() || capitulo.titulo;
}

/** Capítulos consecutivos agrupados para no pasar de `maximo` tramos. */
export function agruparCapitulos(capitulos: Chapter[], maximo: number): TramoCapitulos[] {
  if (capitulos.length === 0) return [];

  const porTramo = Math.max(1, Math.ceil(capitulos.length / maximo));
  const tramos: TramoCapitulos[] = [];

  for (let i = 0; i < capitulos.length; i += porTramo) {
    const grupo = capitulos.slice(i, i + porTramo);
    const inicio = grupo[0];
    const fin = grupo[grupo.length - 1];

    tramos.push({
      id: inicio.id,
      titulo:
        grupo.length === 1
          ? nombreDeCapitulo(inicio)
          : `${nombreDeCapitulo(inicio)} — ${nombreDeCapitulo(fin)}`,
      paginaInicio: inicio.paginaInicio,
      paginaFin: fin.paginaFin,
      capitulos: grupo,
    });
  }

  return tramos;
}

/** Guarda y sirve la estructura del libro; la detección vive aparte, sin base de datos. */
@Injectable()
export class CapitulosService {
  private readonly logger = new Logger(CapitulosService.name);

  constructor(
    @InjectRepository(Chapter) private readonly capitulos: Repository<Chapter>,
    @InjectRepository(DocumentChunk)
    private readonly fragmentos: Repository<DocumentChunk>,
  ) {}

  /** Reemplaza los capítulos del libro y etiqueta cada fragmento con el suyo. */
  async guardar(documentId: string, detectados: CapituloDetectado[]): Promise<Chapter[]> {
    await this.capitulos.delete({ documentId });
    if (detectados.length === 0) return [];

    const guardados = await this.capitulos.save(
      detectados.map((capitulo) => this.capitulos.create({ documentId, ...capitulo })),
    );

    for (const capitulo of guardados) {
      await this.fragmentos
        .createQueryBuilder()
        .update()
        .set({ chapterId: capitulo.id })
        .where('document_id = :documentId', { documentId })
        .andWhere('pagina BETWEEN :inicio AND :fin', {
          inicio: capitulo.paginaInicio,
          fin: capitulo.paginaFin,
        })
        .execute();
    }

    this.logger.log(`Documento ${documentId}: ${guardados.length} capítulos.`);

    return guardados.sort((a, b) => a.orden - b.orden);
  }

  /**
   * Los libros indexados antes de esta versión no tienen capítulos: se derivan
   * de sus fragmentos la primera vez que alguien los pide, sin volver a subirlos.
   */
  async listar(documentId: string): Promise<Chapter[]> {
    const existentes = await this.capitulos.find({
      where: { documentId },
      order: { orden: 'ASC' },
    });

    if (existentes.length > 0) return existentes;

    const paginas = await this.paginasDe(documentId);
    if (paginas.length === 0) return [];

    return this.guardar(documentId, detectarCapitulos(paginas));
  }

  /** Rehace cada página desde sus fragmentos, quitando el solape con el vecino anterior. */
  async paginasDe(documentId: string): Promise<PaginaExtraida[]> {
    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { pagina: true, texto: true, indice: true },
      order: { indice: 'ASC' },
    });

    const porPagina = new Map<number, string[]>();
    for (const fragmento of fragmentos) {
      const previos = porPagina.get(fragmento.pagina) ?? [];
      const palabras = fragmento.texto.split(' ');

      porPagina.set(fragmento.pagina, [
        ...previos,
        (previos.length > 0 ? palabras.slice(SOLAPE) : palabras).join(' '),
      ]);
    }

    return [...porPagina.entries()].map(([pagina, textos]) => ({
      pagina,
      texto: textos.join(' '),
    }));
  }
}
