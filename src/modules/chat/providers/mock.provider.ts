import { Injectable } from '@nestjs/common';

import { LlmProvider, PeticionLlm } from './llm-provider.interface';


@Injectable()
export class MockProvider implements LlmProvider {
  readonly nombre = 'mock';

  /** Simula el goteo del modelo real para que el streaming se pueda probar sin cuota. */
  async *responderStream(peticion: PeticionLlm): AsyncIterable<string> {
    const palabras = (await this.responder(peticion)).split(' ');

    for (let i = 0; i < palabras.length; i += 3) {
      if (peticion.senal?.aborted) return;
      yield palabras.slice(i, i + 3).join(' ') + (i + 3 < palabras.length ? ' ' : '');
      await new Promise((listo) => setTimeout(listo, 30));
    }
  }

  async responder(peticion: PeticionLlm): Promise<string> {
    const frases = this.frasesDelLibro(peticion.systemPrompt);

    if (frases.length === 0) {
      return 'Eso no aparece en este libro.';
    }

    const elegidas = frases.slice(0, 3).join(' ');

    return (
      `Sobre "${peticion.mensaje}", esto es lo que dice el libro. ` +
      `${elegidas} ` +
      '(Respuesta simulada: LLM_PROVIDER=mock en el .env.)'
    );
  }

  private frasesDelLibro(systemPrompt: string): string[] {
    const inicio = systemPrompt.indexOf('--- INICIO DEL LIBRO ---');
    const fin = systemPrompt.indexOf('--- FIN DEL LIBRO ---');
    if (inicio === -1 || fin === -1) return [];

    return systemPrompt
      .slice(inicio + 24, fin)
      .split(/(?<=[.!?])\s+/)
      .map((frase) => frase.replace(/\s+/g, ' ').trim())
      .filter((frase) => frase.split(' ').length >= 8);
  }
}
