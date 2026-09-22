import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CONSTANTS } from '../../common/configuration/constants';
import { PreferenciasEstudio } from '../../common/enums/preferencias-estudio.enum';
import { AnclajeService } from '../anclaje/anclaje.service';
import { DocumentsService } from '../documents/documents.service';
import { Document } from '../documents/entities/document.entity';
import { CapitulosService } from '../documents/services/capitulos.service';
import { LLM_PROVIDER } from '../chat/providers/llm-provider.interface';
import type { LlmProvider } from '../chat/providers/llm-provider.interface';
import { ContextoService } from '../chat/services/contexto.service';
import { PromptService } from '../chat/services/prompt.service';
import { MlService, PaginaEstudio, TipoEstudio } from '../ml/ml.service';
import { UsersService } from '../users/users.service';
import { RegistrarIntentoDto } from './dto/registrar-intento.dto';
import { ResumenService, SeccionResumen } from './services/resumen.service';
import {
  GeneratedContent,
  GeneratedContentType,
} from './entities/generated-content.entity';
import { QuizAttempt } from './entities/quiz-attempt.entity';

/** Lo que el frontend puede dar por hecho de cada tipo de material. */
export interface Tarjeta {
  pregunta: string;
  respuesta: string;
  /** Página del pasaje que la respalda. */
  pagina?: number;
  /** Cómo la armó el motor: definición, contexto o hueco (cloze). */
  tipo?: string;
}

export interface PreguntaQuiz {
  pregunta: string;
  opciones: string[];
  correcta: number;
  pagina?: number;
}

export interface PuntoResumen {
  texto: string;
  pagina: number;
}

export interface Termino {
  termino: string;
  definicion: string;
  pagina: number;
  /** True si el libro lo define ("X significa…"); si no, es la oración más central. */
  esDefinicion: boolean;
}

export interface Evento {
  fecha: string;
  texto: string;
  pagina: number;
}

export type Material =
  | { texto: string; puntos?: PuntoResumen[]; secciones?: SeccionResumen[] }
  | { tarjetas: Tarjeta[]; descartadas?: number }
  | { preguntas: PreguntaQuiz[]; descartadas?: number }
  | { terminos: Termino[] }
  | { eventos: Evento[] };

/** Quién produjo lo que se muestra: el motor propio o Gemini a partir de él. */
export type Origen = 'motor' | 'gemini';

export type Contenido = Material & { origen: Origen };

/** Ítems que pasaron el verificador y cuántos se quitaron por no apoyarse en el libro. */
interface Anclados<T> {
  conservados: T[];
  descartadas: number;
}

/** Los tipos que Gemini sabe producir solo desde el texto, cuando el motor no responde. */
const CON_RESPALDO_GEMINI: GeneratedContentType[] = ['summary', 'flashcards', 'quiz'];

const GENERADOR_POR_TIPO: Record<GeneratedContentType, TipoEstudio> = {
  summary: 'summary',
  flashcards: 'flashcards',
  quiz: 'quiz',
  glossary: 'concepts',
  timeline: 'timeline',
};

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(GeneratedContent)
    private readonly contents: Repository<GeneratedContent>,
    @InjectRepository(QuizAttempt)
    private readonly intentos: Repository<QuizAttempt>,
    private readonly documents: DocumentsService,
    private readonly capitulos: CapitulosService,
    private readonly users: UsersService,
    private readonly prompts: PromptService,
    private readonly contexto: ContextoService,
    private readonly anclaje: AnclajeService,
    private readonly ml: MlService,
    private readonly resumen: ResumenService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * El motor propio arma el material desde el libro; Gemini, si está, solo lo
   * redacta mejor. Si el motor no responde, Gemini lo genera desde el texto y
   * el verificador de anclaje descarta lo que no se apoye en el libro.
   */
  async generar(userId: string, documentId: string, type: GeneratedContentType) {
    const document = await this.documents.obtenerConTexto(userId, documentId);
    const preferencias = await this.users.obtenerPreferencias(userId);

    const paginas = await this.capitulos.paginasDe(documentId);
    const motor =
      type === 'summary'
        ? await this.resumen.generar(documentId, paginas)
        : await this.desdeMotor(type, paginas);

    let content: Contenido;

    if (motor) {
      content =
        (await this.mejorarConGemini(type, motor, document, preferencias)) ??
        { ...motor, origen: 'motor' };
    } else {
      if (!CON_RESPALDO_GEMINI.includes(type)) {
        throw new ServiceUnavailableException(
          'El motor de estudio no está disponible ahora mismo. Vuelve a intentarlo en un momento.',
        );
      }

      this.logger.warn(`Motor de estudio caído: ${type} de ${documentId} lo genera solo Gemini.`);
      const generado = this.normalizar(type, await this.pedirAGemini(type, document, preferencias));
      content = { ...(await this.anclar(documentId, generado)), origen: 'gemini' };
    }

    return this.contents.save(
      this.contents.create({ documentId, userId, type, content }),
    );
  }

  listar(userId: string, documentId: string) {
    return this.contents.find({
      where: { userId, documentId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Guarda un quiz resuelto: es lo que convierte el avance en comprensión. */
  async registrarIntento(
    userId: string,
    documentId: string,
    contentId: string,
    dto: RegistrarIntentoDto,
  ): Promise<QuizAttempt> {
    // El documento va en el WHERE: un intento nunca se atribuye al libro equivocado.
    const material = await this.contents.findOneBy({
      id: contentId,
      userId,
      documentId,
    });

    if (!material) {
      throw new NotFoundException('No se encontró ese material en este libro.');
    }

    if (material.type !== 'quiz') {
      throw new BadRequestException('Solo los quiz registran intentos.');
    }

    return this.intentos.save(
      this.intentos.create({
        contentId,
        documentId,
        userId,
        aciertos: Math.min(dto.aciertos, dto.total),
        total: dto.total,
        falladas: dto.falladas,
      }),
    );
  }

  /** Intentos de un libro, del más reciente al más antiguo. */
  intentos_de(userId: string, documentId: string): Promise<QuizAttempt[]> {
    return this.intentos.find({
      where: { userId, documentId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Igual que los intentos: el material se borra solo por la ruta de su propio libro. */
  async eliminar(userId: string, documentId: string, id: string): Promise<void> {
    await this.contents.delete({ id, userId, documentId });
  }

  // --- Motor propio ---

  /** Null si el motor no responde o no encontró nada con lo que Gemini sí podría. */
  private async desdeMotor(
    type: GeneratedContentType,
    paginas: PaginaEstudio[],
  ): Promise<Material | null> {
    if (paginas.length === 0) return null;

    const resultado = await this.ml.estudio<any>(GENERADOR_POR_TIPO[type], paginas);
    if (!resultado) return null;

    const items = resultado.items ?? [];
    if (items.length === 0 && CON_RESPALDO_GEMINI.includes(type)) return null;

    switch (type) {
      case 'summary':
        // El resumen tiene su propio servicio: va por capítulos y escala con el libro.
        return null;
      case 'flashcards':
        return {
          tarjetas: items.map((t: any) => ({
            pregunta: String(t.pregunta),
            respuesta: String(t.respuesta),
            pagina: Number(t.pagina),
            tipo: String(t.tipo ?? 'motor'),
          })),
        };
      case 'quiz':
        return {
          preguntas: items.map((p: any) => ({
            pregunta: String(p.pregunta),
            opciones: (p.opciones as unknown[]).map(String),
            correcta: Number(p.correcta),
            pagina: Number(p.pagina),
          })),
        };
      case 'glossary':
        return {
          terminos: items.map((t: any) => ({
            termino: String(t.termino),
            definicion: String(t.definicion),
            pagina: Number(t.pagina),
            esDefinicion: Boolean(t.esDefinicion),
          })),
        };
      case 'timeline':
        return {
          eventos: items.map((e: any) => ({
            fecha: String(e.fecha),
            texto: String(e.texto),
            pagina: Number(e.pagina),
          })),
        };
    }
  }

  // --- Gemini como mejora opcional ---

  /** Redacta mejor lo que armó el motor sin cambiar hechos, páginas ni orden; null si no pudo. */
  private async mejorarConGemini(
    type: GeneratedContentType,
    motor: Material,
    document: Document,
    preferencias: PreferenciasEstudio | null,
  ): Promise<Contenido | null> {
    // Con el mock no hay mejora que hacer; y glosario y línea de tiempo son fieles tal cual.
    if (this.llm.nombre === 'mock' || !CON_RESPALDO_GEMINI.includes(type)) return null;

    const criterios = this.prompts.instruccionPreferencias(preferencias);

    try {
      if ('puntos' in motor && motor.puntos) {
        const secciones = motor.secciones ?? [
          { titulo: document.title, paginaInicio: 0, paginaFin: 0, puntos: motor.puntos },
        ];

        const texto = await this.llm.responder({
          systemPrompt:
            `Estos son los pasajes clave del libro "${document.title}", agrupados por tramo ` +
            `del libro y cada uno con su página:\n${JSON.stringify(secciones)}\n` +
            'Redacta un RESUMEN COMPLETO del libro con esta estructura:\n' +
            `1. Abre con un mapa de ideas del libro entero. ${this.prompts.especificacionMapa()}\n` +
            '2. Una sección por tramo, en el mismo orden, con título "### <título del tramo>". ' +
            'Dentro, uno a tres párrafos que expliquen las ideas de sus pasajes (qué pasa, ' +
            'por qué importa, cómo se conecta con lo anterior), no una lista de frases sueltas. ' +
            'Cada dato cita su página así: (pág. N).\n' +
            '3. Cierra con "### Ideas clave": cinco a ocho viñetas "- " con **negritas**.\n' +
            'No agregues hechos que no estén en los pasajes. Nada de tablas ni diagramas de caracteres. ' +
            'La extensión la marca el libro: un libro largo merece un resumen largo.\n' +
            `Adapta el registro a estos criterios, sin mencionarlos ni hablar de sesiones o planes: ${criterios}`,
          historial: [],
          mensaje: 'Redacta el resumen completo a partir de los pasajes.',
          maxTokens: 8192,
        });

        return {
          texto: texto.trim(),
          puntos: motor.puntos,
          secciones: motor.secciones,
          origen: 'gemini',
        };
      }

      if ('tarjetas' in motor) {
        const nuevas = this.comoJson(
          await this.llm.responder({
            systemPrompt:
              'Reescribe estas flashcards para que cada pregunta sea natural y cada respuesta ' +
              'breve y clara, sin cambiar su contenido ni su orden. Devuelve SOLO un JSON array ' +
              'con la misma cantidad de elementos, sin texto alrededor ni ```: ' +
              '[{"pregunta":"...","respuesta":"..."}]\n' +
              `Adapta el registro a estos criterios: ${criterios}\n` +
              `Tarjetas: ${JSON.stringify(motor.tarjetas.map(({ pregunta, respuesta }) => ({ pregunta, respuesta })))}`,
            historial: [],
            mensaje: 'Reescribe las tarjetas.',
          }),
        );

        if (nuevas.length !== motor.tarjetas.length) return null;

        return {
          tarjetas: motor.tarjetas.map((tarjeta, i) => ({
            ...tarjeta,
            pregunta: String(nuevas[i]?.pregunta ?? '').trim() || tarjeta.pregunta,
            respuesta: String(nuevas[i]?.respuesta ?? '').trim() || tarjeta.respuesta,
          })),
          origen: 'gemini',
        };
      }

      if ('preguntas' in motor) {
        const nuevas = this.comoJson(
          await this.llm.responder({
            systemPrompt:
              'Reescribe el enunciado de cada pregunta de este quiz para que sea una pregunta ' +
              'natural cuya respuesta correcta siga siendo la misma opción. No cambies las ' +
              'opciones ni el orden. Devuelve SOLO un JSON array con la misma cantidad de ' +
              'elementos, sin texto alrededor ni ```: [{"pregunta":"..."}]\n' +
              `Adapta el registro a estos criterios: ${criterios}\n` +
              `Quiz: ${JSON.stringify(motor.preguntas.map(({ pregunta, opciones, correcta }) => ({ pregunta, opciones, correcta })))}`,
            historial: [],
            mensaje: 'Reescribe los enunciados.',
          }),
        );

        if (nuevas.length !== motor.preguntas.length) return null;

        return {
          preguntas: motor.preguntas.map((pregunta, i) => ({
            ...pregunta,
            pregunta: String(nuevas[i]?.pregunta ?? '').trim() || pregunta.pregunta,
          })),
          origen: 'gemini',
        };
      }
    } catch (error) {
      // Degradación elegante: el material del motor ya es válido por sí solo.
      this.logger.warn(
        `Gemini no pudo mejorar ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return null;
  }

  /** Camino de respaldo: Gemini genera desde una muestra de todo el libro. */
  private pedirAGemini(
    type: GeneratedContentType,
    document: Document,
    preferencias: PreferenciasEstudio | null,
  ): Promise<string> {
    return this.contexto
      .representativo(document.id, document.extractedText)
      .then((contexto) =>
        this.llm.responder({
          systemPrompt:
            `${this.instruccion(type)}\n` +
            `${this.formato(type)}` +
            `Adapta la dificultad a estos criterios: ${this.prompts.instruccionPreferencias(preferencias)}\n` +
            this.contexto.aviso(contexto.esParcial) +
            'Responde en español y usa únicamente este texto:\n' +
            contexto.contenido,
          historial: [],
          mensaje: this.instruccion(type),
        }),
      );
  }

  /** El resumen se pinta con el renderizador del chat: puede llevar mapa. */
  private formato(type: GeneratedContentType): string {
    return type === 'summary' ? `${this.prompts.especificacionMapa()}\n` : '';
  }

  private instruccion(type: GeneratedContentType): string {
    if (type === 'summary') {
      return (
        'Resume el libro completo, por partes y en orden: una sección "### " por ' +
        'cada parte o capítulo que reconozcas en el texto, con uno o dos párrafos ' +
        'que expliquen sus ideas y citen la página así: (pág. N). Abre con un mapa ' +
        'de ideas y cierra con "### Ideas clave" en viñetas "- " con **negritas**. ' +
        'Nada de tablas ni diagramas de caracteres.'
      );
    }

    if (type === 'flashcards') {
      return (
        'Genera 10 flashcards. Devuelve SOLO un JSON array, sin texto alrededor ' +
        'ni ```: [{"pregunta":"...","respuesta":"..."}]'
      );
    }

    return (
      'Genera un quiz de 5 preguntas con 4 opciones cada una. Devuelve SOLO un ' +
      'JSON array, sin texto alrededor ni ```: ' +
      '[{"pregunta":"...","opciones":["a","b","c","d"],"correcta":0}] ' +
      'donde "correcta" es el índice de la opción correcta, empezando en 0.'
    );
  }

  // --- Verificador de anclaje (solo para lo que Gemini generó sin el motor) ---

  /** Cada tarjeta o pregunta se contrasta con el libro; lo que no se apoya en él se descarta. */
  private async anclar(documentId: string, material: Material): Promise<Material> {
    if ('tarjetas' in material) {
      const anclados = await this.soloAnclados(
        documentId,
        material.tarjetas,
        (tarjeta) => `${tarjeta.pregunta} ${tarjeta.respuesta}`,
      );

      return anclados
        ? { tarjetas: anclados.conservados, descartadas: anclados.descartadas }
        : material;
    }

    if ('preguntas' in material) {
      const anclados = await this.soloAnclados(
        documentId,
        material.preguntas,
        // La afirmación a comprobar es la pregunta con su respuesta correcta.
        (pregunta) => `${pregunta.pregunta} ${pregunta.opciones[pregunta.correcta]}`,
      );

      return anclados
        ? { preguntas: anclados.conservados, descartadas: anclados.descartadas }
        : material;
    }

    return material;
  }

  /** Null cuando el libro no tiene índice: no se puede comprobar, se entrega tal cual. */
  private async soloAnclados<T extends Tarjeta | PreguntaQuiz>(
    documentId: string,
    items: T[],
    afirmacionDe: (item: T) => string,
  ): Promise<Anclados<T> | null> {
    const citas = await this.anclaje.anclarItems(documentId, items.map(afirmacionDe));

    if (citas === null) {
      this.logger.warn(
        `Documento ${documentId} sin índice: el material se guarda sin verificar.`,
      );
      return null;
    }

    const conservados = items.flatMap((item, i) =>
      citas[i].score >= CONSTANTS.GROUNDING_THRESHOLD
        ? [{ ...item, pagina: citas[i].page }]
        : [],
    );

    if (conservados.length === 0) {
      throw new ServiceUnavailableException(
        'El asistente generó material que no coincide con el libro, así que se ' +
          'descartó. Vuelve a generarlo.',
      );
    }

    return { conservados, descartadas: items.length - conservados.length };
  }

  // --- Lectura de lo que devuelve Gemini ---

  /** Deja siempre la misma forma; si el modelo se sale del formato, falla claro. */
  private normalizar(type: GeneratedContentType, crudo: string): Material {
    if (type === 'summary') return { texto: crudo.trim() };

    const datos = this.comoJson(crudo);

    if (type === 'flashcards') {
      const tarjetas = datos
        .map((item) => ({
          pregunta: String(item?.pregunta ?? item?.question ?? '').trim(),
          respuesta: String(item?.respuesta ?? item?.answer ?? '').trim(),
        }))
        .filter((tarjeta) => tarjeta.pregunta && tarjeta.respuesta);

      if (tarjetas.length === 0) throw this.malFormato();

      return { tarjetas };
    }

    const preguntas = datos
      .map((item) => {
        const opciones = (Array.isArray(item?.opciones) ? item.opciones : item?.options)
          ?.map((opcion: unknown) => String(opcion).trim())
          .filter(Boolean) as string[] | undefined;

        return {
          pregunta: String(item?.pregunta ?? item?.question ?? '').trim(),
          opciones: opciones ?? [],
          correcta: this.indiceCorrecto(item, opciones ?? []),
        };
      })
      // Sin clave de respuesta fiable, mejor una pregunta menos que un quiz mal corregido.
      .filter((p) => p.pregunta && p.opciones.length >= 2 && p.correcta >= 0);

    if (preguntas.length === 0) throw this.malFormato();

    return { preguntas };
  }

  /** El índice puede venir como número, como texto de la opción o como "2"; -1 si no se resuelve. */
  private indiceCorrecto(item: any, opciones: string[]): number {
    const valor = item?.correcta ?? item?.answer;
    const esIndice = (n: number) => Number.isInteger(n) && n >= 0 && n < opciones.length;

    if (typeof valor === 'number') return esIndice(valor) ? valor : -1;
    if (typeof valor !== 'string') return -1;

    const texto = valor.trim().toLowerCase();
    const porTexto = opciones.findIndex((opcion) => opcion.toLowerCase() === texto);

    if (porTexto >= 0) return porTexto;

    // Un índice entre comillas es el desliz más común del modelo.
    return /^\d+$/.test(texto) && esIndice(Number(texto)) ? Number(texto) : -1;
  }

  private comoJson(crudo: string): any[] {
    const limpio = crudo
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();

    try {
      const datos: unknown = JSON.parse(limpio);
      if (!Array.isArray(datos)) throw this.malFormato();
      return datos;
    } catch {
      throw this.malFormato();
    }
  }

  private malFormato(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'El asistente devolvió el material en un formato que no se pudo leer. ' +
        'Vuelve a generarlo.',
    );
  }
}
