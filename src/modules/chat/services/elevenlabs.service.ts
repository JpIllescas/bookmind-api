import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CONSTANTS } from '../../../common/configuration/constants';

@Injectable()
export class ElevenLabsService {
  private readonly logger = new Logger(ElevenLabsService.name);

  async sintetizar(texto: string, idioma: 'es' | 'en' = 'es'): Promise<Buffer> {
    if (!CONSTANTS.ELEVENLABS_API_KEY) {
      throw new ServiceUnavailableException(
        'La lectura avanzada no está configurada. Se usará la voz del navegador.',
      );
    }

    const respuesta = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${CONSTANTS.ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': CONSTANTS.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: texto,
          model_id: CONSTANTS.ELEVENLABS_MODEL,
          language_code: idioma,
          voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      this.logger.warn(
        `ElevenLabs respondió ${respuesta.status}: ${detalle.slice(0, 500)}`,
      );
      throw new ServiceUnavailableException('ElevenLabs no pudo generar el audio.');
    }

    return Buffer.from(await respuesta.arrayBuffer());
  }
}
