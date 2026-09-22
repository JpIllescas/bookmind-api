import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolMensaje } from '../../../common/enums/rol-mensaje.enum';
import { DuracionSesion } from '../../../common/enums/preferencias-estudio.enum';
import { ChatMessage } from '../../chat/entities/chat-message.entity';
import { QuizAttempt } from '../../content/entities/quiz-attempt.entity';
import { UsersService } from '../../users/users.service';
import { LessonAttempt } from '../entities/lesson-attempt.entity';

/** XP por acierto en un quiz del Studio; la lección trae el suyo calculado. */
const XP_POR_ACIERTO_QUIZ = 2;

/** XP de cada nivel; el nivel es el número de tramos completos. */
export const XP_POR_NIVEL = 100;

/** Meta diaria según cuánto dice estudiar el alumno por sesión. */
const META_POR_DURACION: Record<DuracionSesion, number> = {
  [DuracionSesion.Corta]: 20,
  [DuracionSesion.Media]: 30,
  [DuracionSesion.Larga]: 50,
};
const META_POR_DEFECTO = 30;

const DIAS_DE_HISTORIAL = 7;
const INICIALES_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export interface DiaDeActividad {
  fecha: string;
  inicial: string;
  xp: number;
  cumplida: boolean;
  esHoy: boolean;
}

export interface ResumenGamificacion {
  xpTotal: number;
  xpHoy: number;
  metaDiaria: number;
  nivel: number;
  /** XP acumulado dentro del nivel actual, para la barra. */
  xpEnNivel: number;
  racha: number;
  mejorRacha: number;
  /** True si hoy todavía no hay actividad y la racha se perdería mañana. */
  rachaEnRiesgo: boolean;
  leccionesTerminadas: number;
  ultimosDias: DiaDeActividad[];
}

/** XP y racha calculados sobre lo que el alumno ya hizo; no hay contadores que mantener. */
@Injectable()
export class GamificacionService {
  constructor(
    @InjectRepository(LessonAttempt) private readonly lecciones: Repository<LessonAttempt>,
    @InjectRepository(QuizAttempt) private readonly quizzes: Repository<QuizAttempt>,
    @InjectRepository(ChatMessage) private readonly mensajes: Repository<ChatMessage>,
    private readonly usuarios: UsersService,
  ) {}

  /**
   * `desfaseMinutos` es el de `Date.getTimezoneOffset()` del navegador: el día
   * del estudiante no termina a la hora UTC.
   */
  async resumen(userId: string, desfaseMinutos: number): Promise<ResumenGamificacion> {
    const [lecciones, quizzes, charlas, preferencias] = await Promise.all([
      this.lecciones.find({ where: { userId }, select: { xp: true, createdAt: true } }),
      this.quizzes.find({ where: { userId }, select: { aciertos: true, createdAt: true } }),
      this.mensajes.find({
        where: { userId, role: RolMensaje.User },
        select: { id: true, createdAt: true },
      }),
      this.usuarios.obtenerPreferencias(userId),
    ]);

    const xpPorDia = new Map<string, number>();
    const diasActivos = new Set<string>();

    const anotar = (fecha: Date, xp: number) => {
      const dia = this.diaDe(fecha, desfaseMinutos);
      diasActivos.add(dia);
      xpPorDia.set(dia, (xpPorDia.get(dia) ?? 0) + xp);
    };

    for (const leccion of lecciones) anotar(leccion.createdAt, leccion.xp);
    for (const quiz of quizzes) anotar(quiz.createdAt, quiz.aciertos * XP_POR_ACIERTO_QUIZ);
    // Preguntar en el chat mantiene la racha, pero no da XP: sería gratis de inflar.
    for (const charla of charlas) anotar(charla.createdAt, 0);

    const hoy = this.diaDe(new Date(), desfaseMinutos);
    const ayer = this.diaDe(this.restarDias(new Date(), 1), desfaseMinutos);
    const xpTotal = [...xpPorDia.values()].reduce((suma, xp) => suma + xp, 0);
    const metaDiaria = preferencias ? META_POR_DURACION[preferencias.duracion] : META_POR_DEFECTO;

    const { actual, mejor } = this.rachas(diasActivos, hoy, ayer);

    return {
      xpTotal,
      xpHoy: xpPorDia.get(hoy) ?? 0,
      metaDiaria,
      nivel: Math.floor(xpTotal / XP_POR_NIVEL) + 1,
      xpEnNivel: xpTotal % XP_POR_NIVEL,
      racha: actual,
      mejorRacha: mejor,
      rachaEnRiesgo: actual > 0 && !diasActivos.has(hoy),
      leccionesTerminadas: lecciones.length,
      ultimosDias: this.ultimosDias(xpPorDia, metaDiaria, desfaseMinutos, hoy),
    };
  }

  /** Racha actual (termina hoy o ayer) y la mejor de la historia. */
  private rachas(diasActivos: Set<string>, hoy: string, ayer: string): { actual: number; mejor: number } {
    const ordenados = [...diasActivos].sort();
    let mejor = 0;
    let seguidos = 0;
    let previo: string | null = null;

    for (const dia of ordenados) {
      seguidos = previo && this.sonConsecutivos(previo, dia) ? seguidos + 1 : 1;
      mejor = Math.max(mejor, seguidos);
      previo = dia;
    }

    // La racha sigue viva si el último día activo es hoy o ayer.
    const ultimo = ordenados[ordenados.length - 1];
    const actual = ultimo === hoy || ultimo === ayer ? seguidos : 0;

    return { actual, mejor };
  }

  private ultimosDias(
    xpPorDia: Map<string, number>,
    meta: number,
    desfase: number,
    hoy: string,
  ): DiaDeActividad[] {
    const dias: DiaDeActividad[] = [];

    for (let atras = DIAS_DE_HISTORIAL - 1; atras >= 0; atras -= 1) {
      const fecha = this.restarDias(new Date(), atras);
      const clave = this.diaDe(fecha, desfase);
      const xp = xpPorDia.get(clave) ?? 0;

      dias.push({
        fecha: clave,
        inicial: INICIALES_DIA[new Date(`${clave}T00:00:00Z`).getUTCDay()],
        xp,
        cumplida: xp >= meta,
        esHoy: clave === hoy,
      });
    }

    return dias;
  }

  /** "AAAA-MM-DD" en la zona horaria del estudiante. */
  private diaDe(fecha: Date, desfaseMinutos: number): string {
    return new Date(fecha.getTime() - desfaseMinutos * 60_000).toISOString().slice(0, 10);
  }

  private restarDias(fecha: Date, dias: number): Date {
    return new Date(fecha.getTime() - dias * 86_400_000);
  }

  private sonConsecutivos(anterior: string, siguiente: string): boolean {
    const a = Date.parse(`${anterior}T00:00:00Z`);
    const b = Date.parse(`${siguiente}T00:00:00Z`);
    return b - a === 86_400_000;
  }
}
