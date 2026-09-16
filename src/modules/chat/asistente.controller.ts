import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AnclajeService } from '../anclaje/anclaje.service';
import { UsersService } from '../users/users.service';
import { PreguntarBibliotecaDto } from './dto/preguntar-biblioteca.dto';
import { LLM_PROVIDER } from './providers/llm-provider.interface';
import type { LlmProvider } from './providers/llm-provider.interface';
import { MetricasLlmService } from './services/metricas-llm.service';
import { PromptService } from './services/prompt.service';

/** Debajo de esto el pasaje habla de otra cosa. */
const MINIMO_PARECIDO = 0.78;

/** Estado del motor conversacional visto desde las llamadas de BookMind. */
@ApiTags('asistente')
@ApiBearerAuth()
@Controller('assistant')
@UseGuards(JwtAuthGuard)
export class AsistenteController {
  constructor(
    private readonly metricas: MetricasLlmService,
    private readonly anclaje: AnclajeService,
    private readonly prompts: PromptService,
    private readonly usuarios: UsersService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** Busca en toda la biblioteca del estudiante y responde citando libro y página. */
  @Post('preguntar')
  async preguntar(
    @CurrentUser() usuario: AuthUser,
    @Body() dto: PreguntarBibliotecaDto,
  ) {
    const pasajes = await this.anclaje.recuperarEnBiblioteca(
      usuario.id,
      dto.pregunta,
      10,
    );

    const utiles = pasajes.filter((p) => p.score >= MINIMO_PARECIDO);

    if (utiles.length === 0) {
      return {
        respuesta:
          'No encontré nada sobre eso en tus libros. Prueba con otras palabras, ' +
          'o sube el libro donde crees que está.',
        fuentes: [],
      };
    }

    const preferencias = await this.usuarios.obtenerPreferencias(usuario.id);

    const respuesta = await this.llm.responder({
      systemPrompt: this.prompts.construirBiblioteca(utiles, preferencias),
      historial: [],
      mensaje: dto.pregunta,
    });

    return {
      respuesta,
      // Se enseñan las fuentes aunque el modelo no las mencione todas.
      fuentes: utiles.map((p) => ({
        documentId: p.documentId,
        titulo: p.titulo,
        tinte: p.tinte,
        pagina: p.pagina,
        extracto: p.texto.slice(0, 220),
        score: Number(p.score.toFixed(4)),
      })),
    };
  }

  @Get('estado')
  // La pantalla se refresca sola; el límite global la cortaría.
  @SkipThrottle()
  estado() {
    return this.metricas.resumen();
  }

  /** Llamada mínima al modelo para saber si responde ahora mismo. */
  // Cada prueba gasta una petición de la cuota diaria: una cada cinco minutos.
  @Throttle({ default: { limit: 1, ttl: 300_000 } })
  @Post('probar')
  async probar() {
    const arranque = Date.now();

    try {
      await this.llm.responder({
        systemPrompt: 'Responde exactamente con la palabra OK.',
        historial: [],
        mensaje: 'OK',
      });

      return { ok: true, ms: Date.now() - arranque, mensaje: null };
    } catch (error) {
      return {
        ok: false,
        ms: Date.now() - arranque,
        mensaje: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
