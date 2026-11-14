import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('app', () => {
  it('health returns the envelope', async () => {
    const res = await buildApp({}).inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { status: 'ok' }, error: null });
  });

  it('tells browsers never to guess the type of anything it sends', async () => {
    const app = buildApp({});

    expect((await app.inject({ method: 'GET', url: '/api/health' })).headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows an extension origin', async () => {
    const origin = 'chrome-extension://abcdefghijklmnop';
    const res = await buildApp({}).inject({ method: 'GET', url: '/api/health', headers: { origin } });
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow a web origin', async () => {
    const res = await buildApp({}).inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers an unknown route with a 404 envelope', async () => {
    const res = await buildApp({}).inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, data: null, error: 'Not found' });
  });

  it('allows a tab that polls every 1.5 s, plus a few more, by default', async () => {
    const app = buildApp({});
    const codes = new Set<number>();
    for (let request = 0; request < 300; request += 1) {
      codes.add((await app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    }

    expect([...codes]).toEqual([200]);
  });

  it('rate limits per IP with a 429 envelope', async () => {
    const app = buildApp({ rateLimitMax: 2 });
    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/api/health' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ success: false, data: null, error: 'Too many requests' });
  });

  it('hides internal error details behind a generic envelope', async () => {
    const app = buildApp({});
    app.get('/api/boom', async () => {
      throw new Error('secret detail');
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ success: false, data: null, error: 'Internal error' });
  });
});
