import { describe, expect, it, vi } from 'vitest';
import { synthesize } from '../src/pipeline/voice';
import { jsonResponse } from './helpers';

const alignment = {
  characters: ['H', 'i'],
  character_start_times_seconds: [0, 0.1],
  character_end_times_seconds: [0.1, 0.2],
};
const audioBytes = Buffer.from('fake-mp3');

function deps(fetchMock: typeof fetch): Parameters<typeof synthesize>[0] {
  return { fetch: fetchMock, apiKey: 'el-key', voiceId: 'voice123', modelId: 'eleven_flash_v2_5' };
}

describe('synthesize', () => {
  it('asks ElevenLabs for speech with timestamps for the joined lines', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ audio_base64: audioBytes.toString('base64'), alignment, normalized_alignment: null }));

    const result = await synthesize(deps(fetchMock), ['Step outside.', 'Food first.']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_128',
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('xi-api-key')).toBe('el-key');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'Step outside.\nFood first.', model_id: 'eleven_flash_v2_5' });
    expect(result.audio.equals(audioBytes)).toBe(true);
    expect(result.alignment).toEqual(alignment);
  });

  it('throws when alignment is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ audio_base64: 'AAAA', alignment: null }));

    await expect(synthesize(deps(fetchMock), ['Hi'])).rejects.toThrow(/alignment/i);
  });

  it('throws on a failed request without echoing the response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'quota exceeded for key el-key' }, 401));

    await expect(synthesize(deps(fetchMock), ['Hi'])).rejects.toThrow(/^ElevenLabs responded with status 401$/);
  });

  it('throws when there is nothing to say', async () => {
    const fetchMock = vi.fn();

    await expect(synthesize(deps(fetchMock), [])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('url-encodes the voice id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ audio_base64: 'AAAA', alignment }));

    await synthesize({ ...deps(fetchMock), voiceId: 'a/b?c' }, ['Hi']);

    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/text-to-speech/a%2Fb%3Fc/with-timestamps');
  });
});
