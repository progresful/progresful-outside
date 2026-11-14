/** Debug aid: open a listing, report the badge, then open the action popup the way a click does. */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', 'apps', 'extension', 'dist', 'chrome-mv3');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const url = process.argv[2];
const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'outside-e2e-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  viewport: { width: 1440, height: 900 },
  args: [...(process.env.HEADED === '1' ? [] : ['--headless=new']), '--remote-debugging-port=9333', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  worker.on('console', (message) => log('  worker console:', message.type(), message.text().slice(0, 300)));
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (message) => {
    if (message.type() === 'error') log('  page error:', message.text().slice(0, 200));
  });
  page.on('pageerror', (error) => log('  page exception:', String(error).slice(0, 300)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (const wait of [2_000, 4_000, 6_000]) {
    await page.waitForTimeout(wait === 2_000 ? 2_000 : 2_000);
    const badge = await page.evaluate(() => {
      const host = document.querySelector('outside-badge');
      return host ? { display: host.style.display, text: host.shadowRoot?.querySelector('.badge-root')?.textContent ?? '' } : null;
    });
    log(`after ${wait / 1000}s badge:`, JSON.stringify(badge));
  }
  const listing = await page.evaluate(() => ({
    title: document.title,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => (node.textContent ?? '').slice(0, 400)),
    hero: Boolean(document.querySelector('[data-section-id="HERO_DEFAULT"]')),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null,
    ldUrls: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => {
      try {
        const parsed = JSON.parse(node.textContent ?? '');
        return { type: parsed['@type'], url: parsed.url ?? null, identifier: parsed.identifier ?? null };
      } catch {
        return null;
      }
    }),
  }));
  log('canonical:', listing.canonical, '| og:url:', listing.ogUrl);
  log('json-ld ids:', JSON.stringify(listing.ldUrls));
  log('title:', listing.title);
  log('json-ld blocks:', listing.ld.length, listing.ld.map((text) => text.slice(0, 160)).join(' || '));
  log('hero found:', listing.hero);

  if (process.env.NO_POPUP === '1') {
    process.exitCode = 0;
    throw new Error('done');
  }
  await page.bringToFront();
  await page.waitForTimeout(500);
  const opened = await worker.evaluate(() => chrome.action.openPopup().then(() => 'opened', (error) => `failed: ${error?.message}`));
  log('openPopup:', opened);
  await page.waitForTimeout(2_500);
  // The action popup is not a Playwright page; Chrome's own debugging endpoint lists it.
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  log('targets:', targets.map((target) => `${target.type} ${target.url.slice(0, 70)}`).join(' | '));
  const popup = targets.find((target) => target.url.includes('/popup.html'));
  if (!popup) {
    log('no popup target');
  } else {
    const socket = new WebSocket(popup.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    const ask = (id, method, params = {}) =>
      new Promise((resolve) => {
        const onMessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id === id) {
            socket.removeEventListener('message', onMessage);
            resolve(message.result ?? message.error);
          }
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id, method, params }));
      });
    const expression = `JSON.stringify({ ready: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(), w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, inner: [innerWidth, innerHeight], text: document.body.innerText.slice(0, 300), rootChildren: document.getElementById('root')?.childElementCount })`;
    log('popup state:', JSON.stringify((await ask(1, 'Runtime.evaluate', { expression }))?.result?.value));
    const shot = await ask(2, 'Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      (await import('node:fs')).writeFileSync(join(out, 'popup-real.png'), Buffer.from(shot.data, 'base64'));
      log('popup screenshot saved');
    } else {
      log('popup screenshot:', JSON.stringify(shot).slice(0, 200));
    }
    socket.close();
  }
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'done') {
    throw error;
  }
} finally {
  await context.close();
}
