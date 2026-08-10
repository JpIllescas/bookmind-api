import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { Cita } from '../chat/entities/chat-message.entity';
import { DocumentChunk } from '../documents/entities/document-chunk.entity';
import { PaginaExtraida } from '../documents/services/extraccion.service';
import { EmbeddingsService } from './services/embeddings.service';
import { FragmentacionService } from './services/fragmentacion.service';

export interface ResultadoAnclaje {
  /** 0..1. Promedio de qué tan anclada al libro está cada afirmación. */
  groundingScore: number;
  citations: Cita[];
  /** Afirmaciones por debajo del umbral: posible alucinación. */
  flaggedClaims: string[];
}

/** Una afirmación más corta que esto no vale la pena verificar. */
const MINIMO_PALABRAS_AFIRMACION = 5;

@Injectable()
export class AnclajeService {
  private readonly logger = new Logger(AnclajeService.name);

  constructor(
    @InjectRepository(DocumentChunk)
    private readonly fragmentos: Repository<DocumentChunk>,
    private readonly embeddings: EmbeddingsService,
    private readonly fragmentacion: FragmentacionService,
  ) {}

  /**
   * Indexa un libro: lo parte en fragmentos y guarda sus embeddings.
   *
   * Devuelve la huella semántica del documento, que sirve para detectar libros
   * repetidos del mismo usuario.
   */
  async indexar(documentId: string, paginas: PaginaExtraida[]): Promise<number[]> {
    const trozos = this.fragmentacion.fragmentar(paginas);
    if (trozos.length === 0) return [];

    const inicio = Date.now();
    const vectores = await this.embeddings.embeberPasajes(trozos.map((t) => t.texto));

    await this.fragmentos.save(
      trozos.map((trozo, i) =>
        this.fragmentos.create({
          documentId,
          indice: trozo.indice,
          pagina: trozo.pagina,
          texto: trozo.texto,
          embedding: vectores[i],
        }),
      ),
      // Sin trocear, un libro grande arma un INSERT con miles de parámetros.
      { chunk: 200 },
    );

    this.logger.log(
      `Documento ${documentId}: ${trozos.length} fragmentos indexados en ` +
        `${((Date.now() - inicio) / 1000).toFixed(1)}s.`,
    );

    return EmbeddingsService.promedio(vectores);
  }

  /**
   * Verifica qué tan anclada al libro está una respuesta de la IA.
   *
   * Es lo que convierte la hipótesis del proyecto en un número: sin esto,
   * "Zero-RAG con aislamiento estricto" sería una afirmación sin evidencia.
   */
  async verificar(documentId: string, respuesta: string): Promise<ResultadoAnclaje> {
    const afirmaciones = this.partirEnAfirmaciones(respuesta);
    if (afirmaciones.length === 0) {
      return { groundingScore: 0, citations: [], flaggedClaims: [] };
    }

    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { id: true, pagina: true, texto: true, embedding: true },
    });

    // Sin índice no se puede afirmar nada: devolver 1.0 seria decir "todo
    // comprobado" cuando no se comprobó nada.
    if (fragmentos.length === 0) {
      this.logger.warn(`El documento ${documentId} no tiene fragmentos indexados.`);
      return { groundingScore: 0, citations: [], flaggedClaims: afirmaciones };
    }

    const vectores = await this.embeddings.embeberConsultas(afirmaciones);

    const citations: Cita[] = [];
    const flaggedClaims: string[] = [];

    afirmaciones.forEach((afirmacion, i) => {
      let mejor = fragmentos[0];
      let mejorPuntaje = -1;

      for (const fragmento of fragmentos) {
        const puntaje = EmbeddingsService.coseno(vectores[i], fragmento.embedding);
        if (puntaje > mejorPuntaje) {
          mejorPuntaje = puntaje;
          mejor = fragmento;
        }
      }

      citations.push({
        claim: afirmacion,
        page: mejor.pagina,
        score: Number(mejorPuntaje.toFixed(4)),
      });

      if (mejorPuntaje < CONSTANTS.GROUNDING_THRESHOLD) {
        flaggedClaims.push(afirmacion);
      }
    });

    const promedio =
      citations.reduce((suma, cita) => suma + cita.score, 0) / citations.length;

    return {
      groundingScore: Number(promedio.toFixed(4)),
      citations,
      flaggedClaims,
    };
  }

  /**
   * Recupera los pasajes más relevantes para una pregunta.
   *
   * Es el plan de contingencia de la sección 5: con Ollama la ventana ronda
   * los 128k tokens y el libro completo no cabe, así que se manda solo esto.
   */
  async recuperar(documentId: string, pregunta: string, cuantos = 8) {
    const [vector] = await this.embeddings.embeberConsultas([pregunta]);

    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { pagina: true, texto: true, embedding: true },
    });

    return fragmentos
      .map((fragmento) => ({
        pagina: fragmento.pagina,
        texto: fragmento.texto,
        score: EmbeddingsService.coseno(vector, fragmento.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cuantos);
  }

  /**
   * Parte la respuesta en afirmaciones verificables.
   *
   * Se corta por oración. No es perfecto (una oración puede llevar dos
   * afirmaciones), pero es la unidad que el estudiante puede contrastar con la
   * página que se le muestra al lado.
   */
  private partirEnAfirmaciones(respuesta: string): string[] {
    return respuesta
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((frase) => frase.trim())
      // Se descartan viñetas y encabezados sueltos: no son afirmaciones sobre
      // el contenido y ensuciarían el promedio.
      .filter((frase) => frase.split(/\s+/).filter(Boolean).length >= MINIMO_PALABRAS_AFIRMACION);
  }
}
