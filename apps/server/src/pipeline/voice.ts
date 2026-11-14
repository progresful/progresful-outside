import { z } from 'zod';

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT_FORMAT = 'mp3_44100_128';
const TIMEOUT_MS = 20_000;
/** A touch faster than the voice's default, so a seven-scene script stays inside 30 seconds and sounds lively. */
const SPEECH_SPEED = 1.1;

const AlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
});

const SpeechSchema = z.object({
  audio_base64: z.string().min(1),
  alignment: AlignmentSchema.nullable(),
});

/** Per-character timing of the spoken text, as ElevenLabs reports it. */
export type Alignment = z.infer<typeof AlignmentSchema>;

export interface VoiceDeps {
  fetch: typeof fetch;
  apiKey: string;
  voiceId: string;
  modelId: string;
}

export interface Speech {
  audio: Buffer;
  alignment: Alignment;
}

/** One request for the whole script, one line per scene, so the video has a single audio track. */
export async function synthesize(deps: VoiceDeps, lines: readonly string[]): Promise<Speech> {
  if (lines.length === 0) {
    throw new Error('There are no lines to voice');
  }
  const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(deps.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': deps.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n'), model_id: deps.modelId, voice_settings: { speed: SPEECH_SPEED } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // The response body can echo request details; keep it out of the error.
    throw new Error(`ElevenLabs responded with status ${res.status}`);
  }
  const speech = SpeechSchema.parse(await res.json());
  if (!speech.alignment) {
    throw new Error('ElevenLabs returned no alignment, so scenes cannot be timed to the voice');
  }
  return { audio: Buffer.from(speech.audio_base64, 'base64'), alignment: speech.alignment };
}
