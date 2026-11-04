/** Quien pide embeddings: una consulta del chat o del anclaje, o el indexado de un libro. */
export type PrioridadEmbeddings = 'consulta' | 'indexado';

export interface MotorEmbeddings {
  embeber(textos: string[]): Promise<number[][]>;
}

interface Pedido {
  textos: string[];
  prioridad: PrioridadEmbeddings;
  vectores: number[][];
  hechos: number;
  resolver: (vectores: number[][]) => void;
  rechazar: (error: unknown) => void;
}

/**
 * Manda al motor un lote a la vez y, entre lote y lote, atiende primero las
 * consultas: una pregunta del chat espera como mucho un lote, no un libro entero.
 */
export class ColaEmbeddings {
  private readonly pendientes: Pedido[] = [];
  private ocupada = false;

  constructor(
    private readonly motor: MotorEmbeddings,
    private readonly lotes: Record<PrioridadEmbeddings, number>,
  ) {}

  embeber(textos: string[], prioridad: PrioridadEmbeddings): Promise<number[][]> {
    if (textos.length === 0) return Promise.resolve([]);

    return new Promise((resolver, rechazar) => {
      this.pendientes.push({ textos, prioridad, vectores: [], hechos: 0, resolver, rechazar });
      void this.atender();
    });
  }

  private async atender(): Promise<void> {
    if (this.ocupada) return;
    const pedido = this.pendientes.find((p) => p.prioridad === 'consulta') ?? this.pendientes[0];
    if (!pedido) return;

    this.ocupada = true;
    const lote = pedido.textos.slice(pedido.hechos, pedido.hechos + this.lotes[pedido.prioridad]);

    try {
      pedido.vectores.push(...(await this.motor.embeber(lote)));
      pedido.hechos += lote.length;
      if (pedido.hechos >= pedido.textos.length) {
        this.quitar(pedido);
        pedido.resolver(pedido.vectores);
      }
    } catch (error) {
      this.quitar(pedido);
      pedido.rechazar(error);
    } finally {
      this.ocupada = false;
      void this.atender();
    }
  }

  private quitar(pedido: Pedido): void {
    this.pendientes.splice(this.pendientes.indexOf(pedido), 1);
  }
}
