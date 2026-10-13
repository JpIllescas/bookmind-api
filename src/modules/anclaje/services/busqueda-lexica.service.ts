import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DocumentChunk } from '../../documents/entities/document-chunk.entity';

/** Tolera signos y preguntas en lenguaje natural; `to_tsquery` lanzaría error. */
const CONSULTA = `websearch_to_tsquery('spanish', :pregunta)`;

/** Palabras sueltas unidas con "or", que websearch_to_tsquery convierte en `|`. */
export function comoAlternativas(pregunta: string): string | null {
  const palabras = pregunta.match(/[\p{L}\p{N}]+/gu) ?? [];
  return palabras.length > 1 ? palabras.join(' or ') : null;
}

/** Ids por relevancia; `conTodas` dice si salieron con todas las palabras o del reintento con cualquiera. */
export interface CoincidenciasLexicas {
  ids: string[];
  conTodas: boolean;
}

/** Búsqueda por palabras (texto completo en español) sobre el índice GIN de `tsv`. */
@Injectable()
export class BusquedaLexicaService {
  constructor(
    @InjectRepository(DocumentChunk)
    private readonly fragmentos: Repository<DocumentChunk>,
  ) {}

  /** Ids de los fragmentos del libro que contienen las palabras de la pregunta, por relevancia. */
  enDocumento(documentId: string, pregunta: string, cuantos: number): Promise<CoincidenciasLexicas> {
    return this.conSegundoIntento(pregunta, (consulta) =>
      this.fragmentos
        .createQueryBuilder('fragmento')
        .select('fragmento.id', 'id')
        .where('fragmento.document_id = :documentId', { documentId })
        .andWhere(`fragmento.tsv @@ ${CONSULTA}`, { pregunta: consulta })
        .orderBy(`ts_rank_cd(fragmento.tsv, ${CONSULTA})`, 'DESC')
        .limit(cuantos)
        .getRawMany<{ id: string }>(),
    );
  }

  /** Lo mismo, pero en todos los libros del estudiante. */
  enBiblioteca(userId: string, pregunta: string, cuantos: number): Promise<CoincidenciasLexicas> {
    return this.conSegundoIntento(pregunta, (consulta) =>
      this.fragmentos
        .createQueryBuilder('fragmento')
        .innerJoin('fragmento.document', 'documento')
        .select('fragmento.id', 'id')
        .where('documento.user_id = :userId', { userId })
        .andWhere(`fragmento.tsv @@ ${CONSULTA}`, { pregunta: consulta })
        .orderBy(`ts_rank_cd(fragmento.tsv, ${CONSULTA})`, 'DESC')
        .limit(cuantos)
        .getRawMany<{ id: string }>(),
    );
  }

  // AND exige todas las palabras: una pregunta larga casi nunca las tiene juntas en un fragmento.
  private async conSegundoIntento(
    pregunta: string,
    buscar: (consulta: string) => Promise<{ id: string }[]>,
  ): Promise<CoincidenciasLexicas> {
    const filas = await buscar(pregunta);
    const alternativas = comoAlternativas(pregunta);
    if (filas.length > 0 || !alternativas) return { ids: filas.map((fila) => fila.id), conTodas: true };

    return { ids: (await buscar(alternativas)).map((fila) => fila.id), conTodas: false };
  }
}
