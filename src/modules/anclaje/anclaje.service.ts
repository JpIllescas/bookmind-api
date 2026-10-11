import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { Cita } from '../chat/entities/chat-message.entity';
import { DocumentChunk } from '../documents/entities/document-chunk.entity';
import { PaginaExtraida } from '../documents/services/extraccion.service';
import { BusquedaLexicaService } from './services/busqueda-lexica.service';
import { EmbeddingsService } from './services/embeddings.service';
import { FragmentacionService } from './services/fragmentacion.service';
import { fusionarRangos } from './services/fusion-rrf';
import { MuestreoService } from './services/muestreo.service';

export interface ResultadoAnclaje {
  groundingScore: number | null;
  citations: Cita[];
  /** Afirmaciones por debajo del umbral: posible alucinación. */
  flaggedClaims: string[];
}

export interface Pasaje {
  pagina: number;
  texto: string;
}

export interface PasajeRecuperado extends Pasaje {
  /** Coseno con la pregunta: sirve de umbral de "hay algo que responder". */
  score: number;
  /** True si además contiene las palabras de la pregunta (búsqueda léxica). */
  lexico: boolean;
}

/** Lo que necesita la fusión de un fragmento candidato. */
type Candidato = Pick<DocumentChunk, 'id' | 'pagina' | 'texto' | 'embedding'>;

/** Cuántos candidatos aporta cada lado (denso y léxico) antes de fusionar. */
const CANDIDATOS_POR_LADO = 24;

/** Lo mínimo del índice para comparar: el texto no hace falta y pesa. */
type FragmentoIndexado = Pick<DocumentChunk, 'pagina' | 'embedding'>;

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
    private readonly muestreo: MuestreoService,
    private readonly lexica: BusquedaLexicaService,
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
          confianzaOcr: trozo.confianza,
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

    const fragmentos = await this.cargarIndice(documentId);

    // Sin índice no hay contra qué comparar, así que nada queda comprobado.
    if (fragmentos.length === 0) {
      return { groundingScore: 0, citations: [], flaggedClaims: afirmaciones };
    }

    const vectores = await this.embeddings.embeberConsultas(afirmaciones);
    const citations = this.citar(afirmaciones, vectores, fragmentos);

    const flaggedClaims = citations
      .filter((cita) => cita.score < CONSTANTS.GROUNDING_THRESHOLD)
      .map((cita) => cita.claim);

    const promedio =
      citations.reduce((suma, cita) => suma + cita.score, 0) / citations.length;

    return {
      groundingScore: Number(promedio.toFixed(4)),
      citations,
      flaggedClaims,
    };
  }

  /**
   * Ancla cada texto entero, sin partirlo en oraciones: sirve para tarjetas y
   * preguntas, que son un ítem cada una. Null si el libro no tiene índice.
   */
  async anclarItems(documentId: string, textos: string[]): Promise<Cita[] | null> {
    if (textos.length === 0) return [];

    const fragmentos = await this.cargarIndice(documentId);
    if (fragmentos.length === 0) return null;

    const vectores = await this.embeddings.embeberConsultas(textos);

    return this.citar(textos, vectores, fragmentos);
  }

  /** Muestra representativa de todo el libro, en orden de lectura y dentro del presupuesto. */
  async representativos(documentId: string, presupuestoCaracteres: number): Promise<Pasaje[]> {
    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { indice: true, pagina: true, texto: true, embedding: true },
      order: { indice: 'ASC' },
    });

    const elegidos = this.muestreo.seleccionar(
      fragmentos.map((f) => ({ embedding: f.embedding, caracteres: f.texto.length })),
      presupuestoCaracteres,
    );

    // MMR elige por novedad; el modelo los necesita en el orden del libro.
    return elegidos
      .sort((a, b) => a - b)
      .map((i) => ({ pagina: fragmentos[i].pagina, texto: fragmentos[i].texto }));
  }

  /** Recupera los pasajes más relevantes cuando el libro no cabe en contexto. */
  async recuperar(
    documentId: string,
    pregunta: string,
    cuantos = 8,
  ): Promise<PasajeRecuperado[]> {
    const [[vector], fragmentos, lexicos] = await Promise.all([
      this.embeddings.embeberConsultas([pregunta]),
      this.fragmentos.find({
        where: { documentId },
        select: { id: true, pagina: true, texto: true, embedding: true },
      }),
      this.lexica.enDocumento(documentId, pregunta, CANDIDATOS_POR_LADO),
    ]);

    return this.fusionar(fragmentos, vector, lexicos, cuantos).map(
      ({ candidato, score, lexico }) => ({
        pagina: candidato.pagina,
        texto: candidato.texto,
        score,
        lexico,
      }),
    );
  }

  /** Busca en todos los libros del estudiante, no solo en el que tiene abierto. */
  async recuperarEnBiblioteca(userId: string, pregunta: string, cuantos = 10) {
    const [[vector], fragmentos, lexicos] = await Promise.all([
      this.embeddings.embeberConsultas([pregunta]),
      this.fragmentos
        .createQueryBuilder('fragmento')
        .innerJoin('fragmento.document', 'documento')
        .select([
          'fragmento.id AS "id"',
          'fragmento.documentId AS "documentId"',
          'fragmento.pagina AS "pagina"',
          'fragmento.texto AS "texto"',
          'fragmento.embedding AS "embedding"',
          'documento.title AS "titulo"',
          'documento.tintColor AS "tinte"',
        ])
        .where('documento.user_id = :userId', { userId })
        .getRawMany<Candidato & { documentId: string; titulo: string; tinte: string }>(),
      this.lexica.enBiblioteca(userId, pregunta, CANDIDATOS_POR_LADO),
    ]);

    return this.fusionar(fragmentos, vector, lexicos, cuantos).map(
      ({ candidato, score, lexico }) => ({
        documentId: candidato.documentId,
        titulo: candidato.titulo,
        tinte: candidato.tinte,
        pagina: candidato.pagina,
        texto: candidato.texto,
        score,
        lexico,
      }),
    );
  }

  /**
   * Búsqueda híbrida: el ranking por coseno y el léxico se combinan con RRF.
   * El coseno se conserva como `score`; la posición fusionada solo ordena.
   */
  private fusionar<T extends Candidato>(
    candidatos: T[],
    vector: number[],
    lexicos: string[],
    cuantos: number,
  ): { candidato: T; score: number; lexico: boolean }[] {
    const conCoseno = candidatos.map((candidato) => ({
      candidato,
      score: EmbeddingsService.coseno(vector, candidato.embedding),
    }));

    const densos = [...conCoseno]
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATOS_POR_LADO)
      .map(({ candidato }) => candidato.id);

    const fusionados = fusionarRangos([densos, lexicos]);
    const enLexico = new Set(lexicos);

    return conCoseno
      .filter(({ candidato }) => fusionados.has(candidato.id))
      // A igual posición fusionada decide el coseno.
      .sort(
        (a, b) =>
          fusionados.get(b.candidato.id)! - fusionados.get(a.candidato.id)! ||
          b.score - a.score,
      )
      .slice(0, cuantos)
      .map(({ candidato, score }) => ({
        candidato,
        score,
        lexico: enLexico.has(candidato.id),
      }));
  }

  private async cargarIndice(documentId: string): Promise<FragmentoIndexado[]> {
    const fragmentos = await this.fragmentos.find({
      where: { documentId },
      select: { pagina: true, embedding: true },
    });

    if (fragmentos.length === 0) {
      this.logger.warn(`El documento ${documentId} no tiene fragmentos indexados.`);
    }

    return fragmentos;
  }

  /** Para cada afirmación, la página del fragmento más parecido y cuánto se parece. */
  private citar(
    afirmaciones: string[],
    vectores: number[][],
    fragmentos: FragmentoIndexado[],
  ): Cita[] {
    return afirmaciones.map((afirmacion, i) => {
      let mejor = fragmentos[0];
      let mejorPuntaje = -1;

      for (const fragmento of fragmentos) {
        const puntaje = EmbeddingsService.coseno(vectores[i], fragmento.embedding);
        if (puntaje > mejorPuntaje) {
          mejorPuntaje = puntaje;
          mejor = fragmento;
        }
      }

      return {
        claim: afirmacion,
        page: mejor.pagina,
        score: Number(mejorPuntaje.toFixed(4)),
      };
    });
  }

  /** Parte la respuesta en afirmaciones verificables, una por oración. */
  private partirEnAfirmaciones(respuesta: string): string[] {
    return this.limpiarMarkdown(respuesta)
      // Cada línea suelta y cada oración se comprueban por separado.
      // Exigir mayúscula después del punto evita partir "(págs. 9-20)".
      .split(/\n+|(?<=[.!?])[^\S\n]+(?=[A-ZÁÉÍÓÚÑ¿¡«"])/)
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
      // Las vallas ``` son estructura; lo de dentro del mapa sí son afirmaciones.
      .replace(/^\s*```[a-záéíóúñ]*\s*$/gim, ' ')
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
      // Solo el espacio horizontal: el salto de línea separa afirmaciones.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }
}
