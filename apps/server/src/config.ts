export const FIXTURE_MODES = ['off', 'record', 'replay'] as const;
export type FixtureMode = (typeof FIXTURE_MODES)[number];

export interface Config {
  contextDevApiKey: string;
  openaiApiKey: string;
  openaiModel: string;
  /** Sent as `reasoning_effort` when set. The default model runs with reasoning off, for speed. */
  openaiReasoningEffort?: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  /** The Context.dev account's requests-per-minute allowance; requests beyond it wait. */
  contextDevRequestsPerMinute: number;
  port: number;
  dataDir: string;
  fixtureMode: FixtureMode;
}

const REQUIRED_KEYS = ['CONTEXT_DEV_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY'] as const;

/**
 * Picked by benchmark on 2026-11-14 (docs/spikes/2026-11-14-sources.md): of the models that kept
 * every script inside the accuracy guard, this one wrote the best lines, in about two seconds.
 */
const DEFAULT_OPENAI_MODEL = 'gpt-6-sol';
const DEFAULT_OPENAI_REASONING_EFFORT = 'none';
/** "George": a warm British storyteller from ElevenLabs' stock voices. */
const DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb';
/** The allowance of a free Context.dev organisation. */
const DEFAULT_CONTEXT_DEV_RPM = 10;

const DEFAULT_PORT = 8787;
const DEFAULT_DATA_DIR = './data';
const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';

type Env = Record<string, string | undefined>;

function value(env: Env, key: string): string | undefined {
  const trimmed = env[key]?.trim();
  return trimmed ? trimmed : undefined;
}

function parseFixtureMode(raw: string | undefined): FixtureMode {
  const mode = raw ?? 'off';
  const known = FIXTURE_MODES.find((candidate) => candidate === mode);
  if (!known) {
    throw new Error(`FIXTURE_MODE must be one of: ${FIXTURE_MODES.join(', ')}`);
  }
  return known;
}

function parsePort(raw: string | undefined): number {
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseRequestsPerMinute(raw: string | undefined): number {
  const perMinute = raw === undefined ? DEFAULT_CONTEXT_DEV_RPM : Number(raw);
  if (!Number.isInteger(perMinute) || perMinute < 1) {
    throw new Error('CONTEXT_DEV_RPM must be a whole number of at least 1');
  }
  return perMinute;
}

/** Reasoning is switched off only for the default model; another model gets what the environment says. */
function reasoningEffort(env: Env): string | undefined {
  const explicit = value(env, 'OPENAI_REASONING_EFFORT');
  return explicit ?? (value(env, 'OPENAI_MODEL') === undefined ? DEFAULT_OPENAI_REASONING_EFFORT : undefined);
}

/** Reads server settings from the environment. Throws naming every required key that is missing. */
export function loadConfig(env: Env): Config {
  const missing = REQUIRED_KEYS.filter((key) => value(env, key) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const required = (key: (typeof REQUIRED_KEYS)[number]): string => value(env, key) as string;
  const effort = reasoningEffort(env);
  return {
    contextDevApiKey: required('CONTEXT_DEV_API_KEY'),
    openaiApiKey: required('OPENAI_API_KEY'),
    openaiModel: value(env, 'OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    ...(effort === undefined ? {} : { openaiReasoningEffort: effort }),
    elevenLabsApiKey: required('ELEVENLABS_API_KEY'),
    elevenLabsVoiceId: value(env, 'ELEVENLABS_VOICE_ID') ?? DEFAULT_ELEVENLABS_VOICE_ID,
    elevenLabsModelId: value(env, 'ELEVENLABS_MODEL_ID') ?? DEFAULT_ELEVENLABS_MODEL_ID,
    contextDevRequestsPerMinute: parseRequestsPerMinute(value(env, 'CONTEXT_DEV_RPM')),
    port: parsePort(value(env, 'PORT')),
    dataDir: value(env, 'DATA_DIR') ?? DEFAULT_DATA_DIR,
    fixtureMode: parseFixtureMode(value(env, 'FIXTURE_MODE')),
  };
}
