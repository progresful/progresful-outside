import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const secrets = {
  CONTEXT_DEV_API_KEY: 'ctx',
  OPENAI_API_KEY: 'oai',
  ELEVENLABS_API_KEY: 'el',
};
const fullEnv = { ...secrets, OPENAI_MODEL: 'some-model', ELEVENLABS_VOICE_ID: 'voice' };

describe('loadConfig', () => {
  it('names every missing key', () => {
    expect(() => loadConfig({})).toThrow(/CONTEXT_DEV_API_KEY.*OPENAI_API_KEY.*ELEVENLABS_API_KEY/s);
  });

  it('needs only the three secrets: the model and the voice have defaults', () => {
    expect(loadConfig(secrets)).toMatchObject({
      openaiModel: 'gpt-6-sol',
      openaiReasoningEffort: 'none',
      elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
      contextDevRequestsPerMinute: 10,
    });
  });

  it('sends no reasoning effort with a model of your own unless you set one', () => {
    expect(loadConfig(fullEnv).openaiReasoningEffort).toBeUndefined();
    expect(loadConfig({ ...fullEnv, OPENAI_REASONING_EFFORT: 'low' }).openaiReasoningEffort).toBe('low');
  });

  it('reads and checks the Context.dev requests-per-minute allowance', () => {
    expect(loadConfig({ ...secrets, CONTEXT_DEV_RPM: '60' }).contextDevRequestsPerMinute).toBe(60);
    expect(() => loadConfig({ ...secrets, CONTEXT_DEV_RPM: '0' })).toThrow(/CONTEXT_DEV_RPM/);
    expect(() => loadConfig({ ...secrets, CONTEXT_DEV_RPM: 'fast' })).toThrow(/CONTEXT_DEV_RPM/);
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
      contextDevRequestsPerMinute: 10,
      port: 8787,
      host: '127.0.0.1',
      trustedProxies: 0,
      buildLimits: { perVisitorPerHour: 120, concurrent: 4, perDay: 1500 },
      dataDir: './data',
      siteDir: '../site/public',
      fixtureMode: 'off',
    });
  });

  it('can be told to listen for a reverse proxy and to serve the landing page from elsewhere', () => {
    const config = loadConfig({ ...fullEnv, HOST: '0.0.0.0', TRUST_PROXY: '1', SITE_DIR: '/srv/outside/site' });

    expect([config.host, config.trustedProxies, config.siteDir]).toEqual(['0.0.0.0', 1, '/srv/outside/site']);
  });

  it('wants to know how many proxies stand in front, never just "trust them all"', () => {
    expect(loadConfig({ ...fullEnv, TRUST_PROXY: '0' }).trustedProxies).toBe(0);
    expect(loadConfig({ ...fullEnv, TRUST_PROXY: '2' }).trustedProxies).toBe(2);
    for (const wrong of ['true', 'yes please', '-1', '1.5']) {
      expect(() => loadConfig({ ...fullEnv, TRUST_PROXY: wrong })).toThrow(/TRUST_PROXY/);
    }
  });

  it('reads and checks how many videos may be built', () => {
    const config = loadConfig({ ...fullEnv, VIDEO_BUILDS_PER_VISITOR_PER_HOUR: '20', VIDEO_BUILDS_AT_ONCE: '2', VIDEO_BUILDS_PER_DAY: '300' });

    expect(config.buildLimits).toEqual({ perVisitorPerHour: 20, concurrent: 2, perDay: 300 });
    expect(() => loadConfig({ ...fullEnv, VIDEO_BUILDS_AT_ONCE: '0' })).toThrow(/VIDEO_BUILDS_AT_ONCE/);
    expect(() => loadConfig({ ...fullEnv, VIDEO_BUILDS_PER_DAY: 'plenty' })).toThrow(/VIDEO_BUILDS_PER_DAY/);
  });

  it('reads overrides', () => {
    const config = loadConfig({ ...fullEnv, PORT: '9000', DATA_DIR: '/tmp/x', FIXTURE_MODE: 'replay' });
    expect([config.port, config.dataDir, config.fixtureMode]).toEqual([9000, '/tmp/x', 'replay']);
  });

  it('rejects an unknown fixture mode', () => {
    expect(() => loadConfig({ ...fullEnv, FIXTURE_MODE: 'sometimes' })).toThrow(/FIXTURE_MODE/);
  });
});
