import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

function siteFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'outside-site-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Outside</title>');
  writeFileSync(join(dir, '.secret'), 'not for visitors');
  mkdirSync(join(dir, 'css'));
  writeFileSync(join(dir, 'css', 'site.css'), 'body{}');
  mkdirSync(join(dir, 'download'));
  writeFileSync(join(dir, 'download', 'outside-extension.zip'), 'PK');
  return dir;
}

const NOT_FOUND = { success: false, data: null, error: 'Not found' };

describe('the landing page', () => {
  const app = buildApp({ siteDir: siteFolder() });
  const get = (url: string) => app.inject({ method: 'GET', url });

  it('is served at the root when a site folder is given', async () => {
    const res = await get('/');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>Outside</title>');
  });

  it('serves its styles, and the extension as a download', async () => {
    expect((await get('/css/site.css')).headers['content-type']).toContain('text/css');
    const zip = await get('/download/outside-extension.zip');
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
  });

  it('serves part of a file when asked, which is how a browser jumps about in the voice track', async () => {
    const res = await app.inject({ method: 'GET', url: '/css/site.css', headers: { range: 'bytes=0-3' } });

    expect(res.statusCode).toBe(206);
    expect(res.body).toBe('body');
    expect(res.headers['content-range']).toBe('bytes 0-3/6');
  });

  it('lets nothing frame the page, and lets the page load nothing from elsewhere', async () => {
    const { headers } = await get('/');

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('always hands out the newest page and download, and lets the rest be kept for a while', async () => {
    expect((await get('/')).headers['cache-control']).toBe('no-cache');
    expect((await get('/download/outside-extension.zip')).headers['cache-control']).toBe('no-cache');
    expect((await get('/css/site.css')).headers['cache-control']).toBe('public, max-age=3600');
  });

  it('does not serve hidden files or anything outside the folder', async () => {
    const urls = ['/.secret', '/../package.json', '/%2e%2e/%2e%2e/package.json', '/css/../../package.json', '/nope.html', '/%00', '/index.html/..%5c..%5c.secret'];
    for (const url of urls) {
      const res = await get(url);
      expect([url, res.statusCode]).toEqual([url, 404]);
      expect(res.json()).toEqual(NOT_FOUND);
    }
  });

  it('keeps the api beside it', async () => {
    expect((await get('/api/health')).json()).toEqual({ success: true, data: { status: 'ok' }, error: null });
    expect((await get('/api/nope')).json()).toEqual(NOT_FOUND);
  });

  it('is not there when no site folder is given', async () => {
    const res = await buildApp({}).inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual(NOT_FOUND);
  });
});

describe('behind a reverse proxy', () => {
  const visit = (app: ReturnType<typeof buildApp>, ip: string) =>
    app.inject({ method: 'GET', url: '/api/health', headers: { 'x-forwarded-for': ip } });

  it('counts each visitor on their own when told one proxy stands in front', async () => {
    const app = buildApp({ rateLimitMax: 1, trustedProxies: 1 });

    expect((await visit(app, '203.0.113.7')).statusCode).toBe(200);
    expect((await visit(app, '203.0.113.7')).statusCode).toBe(429);
    expect((await visit(app, '198.51.100.9')).statusCode).toBe(200);
  });

  it('goes by the address the proxy saw, not by one the visitor wrote in front of it', async () => {
    const app = buildApp({ rateLimitMax: 1, trustedProxies: 1 });

    // nginx appends what it saw to whatever the visitor sent; only the last entry is the proxy's word.
    expect((await visit(app, '1.1.1.1, 203.0.113.7')).statusCode).toBe(200);
    expect((await visit(app, '2.2.2.2, 203.0.113.7')).statusCode).toBe(429);
  });

  it('ignores the forwarded address otherwise: a visitor could write anything there', async () => {
    const app = buildApp({ rateLimitMax: 1 });

    expect((await visit(app, '203.0.113.7')).statusCode).toBe(200);
    expect((await visit(app, '198.51.100.9')).statusCode).toBe(429);
  });
});
