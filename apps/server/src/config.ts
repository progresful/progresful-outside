export const FIXTURE_MODES = ['off', 'record', 'replay'] as const;
export type FixtureMode = (typeof FIXTURE_MODES)[number];

export interface Config {
  contextDevApiKey: string;
  openaiApiKey: string;
  openaiModel: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  port: number;
  dataDir: string;
  fixtureMode: FixtureMode;
}

const REQUIRED_KEYS = [
  'CONTEXT_DEV_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID',
] as const;

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

/** Reads server settings from the environment. Throws naming every required key that is missing. */
export function loadConfig(env: Env): Config {
  const missing = REQUIRED_KEYS.filter((key) => value(env, key) === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const required = (key: (typeof REQUIRED_KEYS)[number]): string => value(env, key) as string;
  return {
    contextDevApiKey: required('CONTEXT_DEV_API_KEY'),
    openaiApiKey: required('OPENAI_API_KEY'),
    openaiModel: required('OPENAI_MODEL'),
    elevenLabsApiKey: required('ELEVENLABS_API_KEY'),
    elevenLabsVoiceId: required('ELEVENLABS_VOICE_ID'),
    elevenLabsModelId: value(env, 'ELEVENLABS_MODEL_ID') ?? DEFAULT_ELEVENLABS_MODEL_ID,
    port: parsePort(value(env, 'PORT')),
    dataDir: value(env, 'DATA_DIR') ?? DEFAULT_DATA_DIR,
    fixtureMode: parseFixtureMode(value(env, 'FIXTURE_MODE')),
  };
}
