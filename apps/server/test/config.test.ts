import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const fullEnv = {
  CONTEXT_DEV_API_KEY: 'ctx',
  OPENAI_API_KEY: 'oai',
  OPENAI_MODEL: 'some-model',
  ELEVENLABS_API_KEY: 'el',
  ELEVENLABS_VOICE_ID: 'voice',
};

describe('loadConfig', () => {
  it('names every missing key', () => {
    expect(() => loadConfig({})).toThrow(
      /CONTEXT_DEV_API_KEY.*OPENAI_API_KEY.*OPENAI_MODEL.*ELEVENLABS_API_KEY.*ELEVENLABS_VOICE_ID/s,
    );
  });

  it('treats an empty value as missing', () => {
    expect(() => loadConfig({ ...fullEnv, OPENAI_API_KEY: '' })).toThrow(/OPENAI_API_KEY/);
  });

  it('applies defaults for optional settings', () => {
    expect(loadConfig(fullEnv)).toEqual({
      contextDevApiKey: 'ctx',
      openaiApiKey: 'oai',
      openaiModel: 'some-model',
      elevenLabsApiKey: 'el',
      elevenLabsVoiceId: 'voice',
      elevenLabsModelId: 'eleven_flash_v2_5',
      port: 8787,
      dataDir: './data',
      fixtureMode: 'off',
    });
  });

  it('reads overrides', () => {
    const config = loadConfig({ ...fullEnv, PORT: '9000', DATA_DIR: '/tmp/x', FIXTURE_MODE: 'replay' });
    expect([config.port, config.dataDir, config.fixtureMode]).toEqual([9000, '/tmp/x', 'replay']);
  });

  it('rejects an unknown fixture mode', () => {
    expect(() => loadConfig({ ...fullEnv, FIXTURE_MODE: 'sometimes' })).toThrow(/FIXTURE_MODE/);
  });
});
