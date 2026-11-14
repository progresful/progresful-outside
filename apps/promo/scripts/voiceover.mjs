/**
 * Voices the narrator's lines with ElevenLabs: one mp3 per line in public/vo, and their lengths
 * in src/content/vo.json, which the film is timed from. A line whose text and voice have not changed
 * is not voiced again.
 *
 *   pnpm --filter @outside/promo voiceover            voice what is new or changed
 *   pnpm --filter @outside/promo voiceover --voices   list the voices the account can use
 *
 * The key is read from ELEVENLABS_API_KEY (the repo's .env) and is never printed.
 *   PROMO_VOICE_ID   the narrator's voice (default: see below)
 *   PROMO_MODEL_ID   the ElevenLabs model (default: eleven_multilingual_v2)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.elevenlabs.io/v1';
/** "Lily": a warm British narrator from ElevenLabs' stock voices, distinct from George, who speaks inside the product. */
const DEFAULT_VOICE_ID = 'pFZP5JQG7iQjIQuC4Bku';
/**
 * The slower, fuller model: the film is made once, so quality matters more than speed. It costs a
 * credit a character; PROMO_MODEL_ID=eleven_flash_v2_5 costs about half and sounds a little flatter.
 */
const MODEL_ID = process.env.PROMO_MODEL_ID?.trim() || 'eleven_multilingual_v2';
/** 192 kbps needs a higher ElevenLabs plan than this account's (it answers output_format_not_allowed); 128 is what the product uses too. */
const OUTPUT_FORMAT = 'mp3_44100_128';
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.0 };
const TIMEOUT_MS = 60_000;

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, '..', 'src', 'content', 'script.json');
const voPath = join(here, '..', 'src', 'content', 'vo.json');
const audioDir = join(here, '..', 'public', 'vo');

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
if (!apiKey) {
  throw new Error('ELEVENLABS_API_KEY is not set. Run this through `pnpm --filter @outside/promo voiceover`, which reads the repo .env.');
}
const voiceId = process.env.PROMO_VOICE_ID?.trim() || DEFAULT_VOICE_ID;

async function call(path, init) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'xi-api-key': apiKey, ...init?.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    // The body can echo request details; only the status and ElevenLabs' own short reason code are reported.
    const reason = await response.json().then((body) => body?.detail?.status, () => undefined);
    throw new Error(`ElevenLabs answered ${response.status}${typeof reason === 'string' ? ` (${reason.slice(0, 60)})` : ''} for ${path.split('?')[0]}`);
  }
  return response.json();
}

async function listVoices() {
  const { voices } = await call('/voices');
  for (const voice of voices) {
    const labels = voice.labels ?? {};
    process.stdout.write(`${voice.voice_id}  ${String(voice.name).padEnd(34)} ${[labels.gender, labels.accent, labels.age, labels.descriptive ?? labels.description, labels.use_case].filter(Boolean).join(', ')}\n`);
  }
}

/** What decides how a line sounds: change any of it and the line is voiced again. */
function fingerprint(text) {
  return createHash('sha256').update(JSON.stringify([text, voiceId, MODEL_ID, OUTPUT_FORMAT, VOICE_SETTINGS])).digest('hex').slice(0, 16);
}

async function voiceLine(line, before, after) {
  const speech = await call(`/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The lines around it tell the voice how the sentence sits in the whole, so it does not start each one cold.
    body: JSON.stringify({ text: line.text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS, previous_text: before, next_text: after }),
  });
  const ends = speech.alignment?.character_end_times_seconds ?? [];
  const durationSec = ends.at(-1);
  if (typeof speech.audio_base64 !== 'string' || typeof durationSec !== 'number') {
    throw new Error(`ElevenLabs returned no audio or timing for "${line.id}"`);
  }
  return { audio: Buffer.from(speech.audio_base64, 'base64'), durationSec };
}

function save(voiced) {
  writeFileSync(voPath, `${JSON.stringify({ voiceId, modelId: MODEL_ID, lines: voiced }, null, 2)}\n`);
}

async function voiceAll() {
  const { lines } = JSON.parse(readFileSync(scriptPath, 'utf8'));
  const known = existsSync(voPath) ? JSON.parse(readFileSync(voPath, 'utf8')).lines : [];
  mkdirSync(audioDir, { recursive: true });

  const voiced = [];
  const waiting = [];
  for (const [index, line] of lines.entries()) {
    const print = fingerprint(line.text);
    const kept = known.find((entry) => entry.id === line.id && entry.fingerprint === print);
    if (kept && existsSync(join(audioDir, `${line.id}.mp3`))) {
      voiced.push(kept);
      process.stdout.write(`kept    ${line.id}  ${kept.durationSec.toFixed(2)}s\n`);
      continue;
    }
    try {
      const { audio, durationSec } = await voiceLine(line, lines[index - 1]?.text, lines[index + 1]?.text);
      writeFileSync(join(audioDir, `${line.id}.mp3`), audio);
      voiced.push({ id: line.id, scene: line.scene, file: `vo/${line.id}.mp3`, durationSec: Number(durationSec.toFixed(3)), fingerprint: print });
      // Saved line by line: a refusal halfway keeps what has been paid for.
      save(voiced);
      process.stdout.write(`voiced  ${line.id}  ${durationSec.toFixed(2)}s\n`);
    } catch (error) {
      const why = error instanceof Error ? error.message : 'failed';
      process.stdout.write(`waiting ${line.id}  ${why}\n`);
      waiting.push(line.id);
      if (why.includes('quota_exceeded')) {
        // Out of credit: asking for the remaining lines would only be refused too.
        waiting.push(...lines.slice(index + 1).map((rest) => rest.id));
        break;
      }
    }
  }
  // Lines that were voiced earlier and come after a refusal are kept as they are.
  const reached = new Set([...voiced.map((entry) => entry.id), ...waiting]);
  voiced.push(...known.filter((entry) => !reached.has(entry.id) && lines.some((line) => line.id === entry.id && fingerprint(line.text) === entry.fingerprint)));
  save(voiced);
  process.stdout.write(`total   ${voiced.reduce((sum, entry) => sum + entry.durationSec, 0).toFixed(1)}s of narration in ${voiced.length} of ${lines.length} lines\n`);
  if (waiting.length > 0) {
    process.stdout.write(`The film shows these lines as captions until they are voiced: ${waiting.join(', ')}\n`);
    process.exitCode = 1;
  }
}

await (process.argv.includes('--voices') ? listVoices() : voiceAll());
