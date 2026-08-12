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
  groundingScore: number | null;
  citations: Cita[];
  /** Afirmaciones por debajo del umbral: posible alucinación. */
  flaggedClaims: string[];
}

/** Una afirmación más corta que esto no vale la pena verificar. */
const MINIMO_PALABRAS_AFIRMACION = 5;

/** Frases sobre la conversación, no sobre el libro: se excluyen del anclaje. */
const FRASES_META = [
  /no aparece en (este|el) libro/i,
  /no (se )?(menciona|encuentra|habla|dice) (nada )?(sobre|de|en) (este|el) libro/i,
  /(el|este) libro no (habla|menciona|trata|incluye|contiene)/i,
  /puedes (revisar|consultar|ver|encontrar)(lo| esto| este dato| más)? en (el|la|las|los)? ?(capítulo|página|sección)/i,
  /(lo|esto) (encuentras|puedes ver) en (el|la) (capítulo|página|sección)/i,
];

@Injectable()
export class AnclajeService {
  private readonly logger = new Logger(AnclajeService.name);

  constructor(
    @InjectRepository(DocumentChunk)
    private readonly fragmentos: Repository<DocumentChunk>,
    private readonly embeddings: EmbeddingsService,
    private readonly fragmentacion: FragmentacionService,
  ) {}

  /** Parte el libro en fragmentos, los embebe y devuelve su huella semántica. */
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

  /** Mide qué tan anclada al libro está una respuesta de la IA. */
  async verificar(documentId: string, respuesta: string): Promise<ResultadoAnclaje> {
    const afirmaciones = this.partirEnAfirmaciones(respuesta);

    // Solo frases meta: no hay nada que anclar, que no es estar mal anclado.
    if (afirmaciones.length === 0) {
      return { groundingScore: null, citations: [], flaggedClaims: [] };
    }

    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { id: true, pagina: true, texto: true, embedding: true },
    });

    // Sin índice no hay contra qué comparar, así que nada queda comprobado.
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

  /** Recupera los pasajes más relevantes cuando el libro no cabe en contexto. */
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

  /** Parte la respuesta en afirmaciones verificables, una por oración. */
  private partirEnAfirmaciones(respuesta: string): string[] {
    return this.limpiarMarkdown(respuesta)
      // Exigir mayúscula después del punto evita partir "(págs. 9-20)".
      .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡«"])/)
      .map((frase) => frase.trim())
      // Viñetas y encabezados sueltos ensuciarían el promedio.
      .filter(
        (frase) => frase.split(/\s+/).filter(Boolean).length >= MINIMO_PALABRAS_AFIRMACION,
      )
      .filter((frase) => !FRASES_META.some((patron) => patron.test(frase)));
  }

  /** Quita el Markdown: sus símbolos no están en el libro y bajan la similitud. */
  private limpiarMarkdown(texto: string): string {
    return texto
      // Encabezados y separadores: son estructura, no afirmaciones.
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
      // Viñetas y numeración al inicio de línea.
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      // Énfasis y código, conservando el texto de dentro.
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      // Enlaces: se queda el texto, no la URL.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
