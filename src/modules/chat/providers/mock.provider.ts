import { Injectable } from '@nestjs/common';

import { LlmProvider, PeticionLlm } from './llm-provider.interface';


@Injectable()
export class MockProvider implements LlmProvider {
  readonly nombre = 'mock';

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
