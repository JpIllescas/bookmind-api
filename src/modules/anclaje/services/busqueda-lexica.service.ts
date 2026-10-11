import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentChunk } from '../../documents/entities/document-chunk.entity';

/** Tolera signos y preguntas en lenguaje natural; `to_tsquery` lanzaría error. */
const CONSULTA = `websearch_to_tsquery('spanish', :pregunta)`;

/** Búsqueda por palabras (texto completo en español) sobre el índice GIN de `tsv`. */
@Injectable()
export class BusquedaLexicaService {
  constructor(
    @InjectRepository(DocumentChunk)
    private readonly fragmentos: Repository<DocumentChunk>,
  ) {}

  /** Ids de los fragmentos del libro que contienen las palabras de la pregunta, por relevancia. */
  async enDocumento(
    documentId: string,
    pregunta: string,
    cuantos: number,
  ): Promise<string[]> {
    const filas = await this.fragmentos
      .createQueryBuilder('fragmento')
      .select('fragmento.id', 'id')
      .where('fragmento.document_id = :documentId', { documentId })
      .andWhere(`fragmento.tsv @@ ${CONSULTA}`, { pregunta })
      .orderBy(`ts_rank_cd(fragmento.tsv, ${CONSULTA})`, 'DESC')
      .limit(cuantos)
      .getRawMany<{ id: string }>();

    return filas.map((fila) => fila.id);
  }

  /** Lo mismo, pero en todos los libros del estudiante. */
  async enBiblioteca(
    userId: string,
    pregunta: string,
    cuantos: number,
  ): Promise<string[]> {
    const filas = await this.fragmentos
      .createQueryBuilder('fragmento')
      .innerJoin('fragmento.document', 'documento')
      .select('fragmento.id', 'id')
      .where('documento.user_id = :userId', { userId })
      .andWhere(`fragmento.tsv @@ ${CONSULTA}`, { pregunta })
      .orderBy(`ts_rank_cd(fragmento.tsv, ${CONSULTA})`, 'DESC')
      .limit(cuantos)
      .getRawMany<{ id: string }>();

    return filas.map((fila) => fila.id);
  }
}
