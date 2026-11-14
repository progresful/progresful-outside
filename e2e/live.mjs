/**
 * Live check: loads the built extension in Chromium, opens a real listing and watches the badge.
 * Needs the local server running (pnpm dev:server) and the extension built (pnpm build:extension).
 *
 *   node e2e/live.mjs airbnb            # finds a Lisbon listing by itself (or: booking)
 *   node e2e/live.mjs <listing url>     # a specific Airbnb or Booking.com listing
 *
 * Set CHROMIUM=<path to a Chromium binary> to use one other than Playwright's own; HEADED=1 to watch;
 * INTERESTS=water,nightlife to also change the interests afterwards and wait for the rebuilt video.
 * Screenshots and a page dump go to e2e/out/ (git-ignored).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', 'apps', 'extension', '.output', 'chrome-mv3');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const target = process.argv[2] ?? 'airbnb';
const headed = process.env.HEADED === '1';
const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'outside-e2e-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  args: [
    ...(headed ? [] : ['--headless=new']),
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function findAirbnbListing(page) {
  await page.goto('https://www.airbnb.com/s/Lisbon--Portugal/homes?checkin=2026-11-20&checkout=2026-11-24&adults=2', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href*="/rooms/"]', { timeout: 30_000 });
  const href = await page.locator('a[href*="/rooms/"]').first().getAttribute('href');
  const id = /\/rooms\/(\d+)/.exec(href ?? '')?.[1];
  return `https://www.airbnb.com/rooms/${id}?check_in=2026-11-20&check_out=2026-11-24&adults=2`;
}

async function findBookingListing(page) {
  await page.goto('https://www.booking.com/searchresults.en-gb.html?ss=Lisbon&checkin=2026-11-20&checkout=2026-11-24&group_adults=2', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href*="/hotel/"]', { timeout: 30_000 });
  await page.waitForSelector('a[href*="/hotel/pt/"]', { timeout: 30_000 });
  const hrefs = await page.locator('a[href*="/hotel/pt/"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const path = hrefs.map((href) => /\/hotel\/[a-z]{2}\/[^.?/]+/.exec(href)?.[0]).find(Boolean);
  return `https://www.booking.com${path}.en-gb.html?checkin=2026-11-20&checkout=2026-11-24&group_adults=2`;
}

/** Text of the badge's shadow root, or null when there is no badge. */
const badgeText = (page) =>
  page.evaluate(() => document.querySelector('outside-badge')?.shadowRoot?.querySelector('.badge-root')?.textContent ?? null);

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  log('extension id', new URL(worker.url()).host);
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (message) => {
    if (message.type() === 'error' && /outside|chrome-extension/i.test(message.text())) log('  page error:', message.text().slice(0, 200));
  });

  const url = target === 'airbnb' ? await findAirbnbListing(page) : target === 'booking' ? await findBookingListing(page) : target;
  log('listing', url);
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  let last = '';
  let ready = false;
  for (let tick = 0; tick < 150 && !ready; tick += 1) {
    const text = await badgeText(page).catch(() => null);
    const line = text ?? '(no badge)';
    if (line !== last) {
      log(`${((Date.now() - started) / 1000).toFixed(1)}s badge: ${line}`);
      last = line;
    }
    ready = /what.s outside/i.test(line);
    if (/couldn|failed|retry|not enough|unreachable/i.test(line)) break;
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(out, `listing-badge-${target.startsWith('http') ? 'url' : target}.png`) });
  writeFileSync(
    join(out, `listing-meta-${target.startsWith('http') ? 'url' : target}.json`),
    JSON.stringify(
      await page.evaluate(() => ({
        title: document.title,
        ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
        ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
        jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent?.slice(0, 3000)),
        hero: Boolean(document.querySelector('[data-section-id="HERO_DEFAULT"]')),
        url: location.href,
        latlng: document.querySelector('[data-atlas-latlng]')?.getAttribute('data-atlas-latlng') ?? null,
        galleryCandidates: ['#photo_wrapper', '[data-testid="GalleryUnifiedDesktop-wrapper"]', '[data-testid="property-gallery"]', '.bh-photo-grid', '#hotel_main_content', '[data-capla-component-boundary*="Gallery"]', '[aria-label*="hoto"]']
          .map((selector) => [selector, document.querySelectorAll(selector).length]),
        badge: (() => {
          const rect = document.querySelector('outside-badge')?.getBoundingClientRect();
          return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
        })(),
      })),
      null,
      2,
    ),
  );

  if (ready) {
    await page.evaluate(() => {
      const root = document.querySelector('outside-badge')?.shadowRoot;
      (root?.querySelector('button') ?? root?.querySelector('.badge-root')?.firstElementChild)?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    });
    const frameHandle = await page.waitForSelector('iframe[src^="chrome-extension://"]', { timeout: 10_000 });
    const frame = await frameHandle.contentFrame();
    for (const second of [2, 7, 13, 18, 23]) {
      await page.waitForTimeout(second === 2 ? 2_000 : 5_000);
      await page.screenshot({ path: join(out, `player-${String(second).padStart(2, '0')}s.png`) });
      const audio = await frame?.evaluate(() => {
        const element = document.querySelector('audio');
        return element ? { paused: element.paused, time: Number(element.currentTime.toFixed(1)), muted: element.muted } : null;
      }).catch(() => 'frame gone');
      log(`player at ~${second}s: audio ${JSON.stringify(audio)}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    log('overlay after Escape:', await page.locator('iframe[src^="chrome-extension://"]').count());
    await page.screenshot({ path: join(out, 'listing-after-close.png') });
  }

  if (ready && process.env.INTERESTS) {
    const interests = process.env.INTERESTS.split(',');
    const changed = Date.now();
    await worker.evaluate((picked) => chrome.storage.sync.set({ interests: picked }), interests);
    log('interests set to', interests.join(', '));
    let seen = '';
    let rebuilt = false;
    let wasBusy = false;
    for (let tick = 0; tick < 150 && !rebuilt; tick += 1) {
      const text = (await badgeText(page).catch(() => null)) ?? '(no badge)';
      if (text !== seen) {
        log(`${((Date.now() - changed) / 1000).toFixed(1)}s badge: ${text}`);
        seen = text;
      }
      wasBusy ||= !/^what.s outside$/i.test(text.trim());
      rebuilt = wasBusy && /^what.s outside$/i.test(text.trim());
      await page.waitForTimeout(300);
    }
    log(rebuilt ? 'rebuilt for the new interests' : 'no rebuild seen');
  }
} finally {
  await context.close();
}
