/**
 * Takes the real pictures the promo opens on: the release extension at work on a real Airbnb
 * listing, talking to the hosted server. It writes screenshots to public/capture and, to
 * src/content/capture.json, where the badge sat and what it said while the video was built.
 *
 *   node apps/promo/scripts/capture.mjs [listing url]
 *
 * Headless and muted. Needs `pnpm bundle` to have been run (it loads apps/extension/dist-release).
 * Set CHROMIUM=<path to a Chromium binary> to use one other than Playwright's own.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', '..', 'extension', 'dist-release', 'chrome-mv3');
const shots = join(here, '..', 'public', 'capture');
const data = join(here, '..', 'src', 'content');
mkdirSync(shots, { recursive: true });
mkdirSync(data, { recursive: true });

const WIDTH = 1920;
const HEIGHT = 1080;
const INTERESTS = ['adventure', 'nature'];
const listing = process.argv[2] ?? 'https://www.airbnb.com/rooms/39199892?check_in=2027-01-10&check_out=2027-01-13&adults=2';
const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'outside-promo-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  locale: 'en-GB',
  args: ['--headless=new', '--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

/** What the badge says and where it sits, or null when there is none. */
const readBadge = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('outside-badge');
    const root = host?.shadowRoot?.querySelector('.badge-root');
    const pill = root?.firstElementChild;
    if (!host || !root || !pill) {
      return null;
    }
    const box = pill.getBoundingClientRect();
    return { text: root.textContent ?? '', x: box.x, y: box.y, width: box.width, height: box.height };
  });

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  await worker.evaluate((picked) => chrome.storage.sync.set({ interests: picked }), INTERESTS);
  const page = context.pages()[0] ?? (await context.newPage());

  const started = Date.now();
  await page.goto(listing, { waitUntil: 'domcontentloaded' });

  const stages = [];
  let badge = null;
  let ready = false;
  for (let tick = 0; tick < 900 && !ready; tick += 1) {
    const seen = await readBadge(page).catch(() => null);
    if (seen && seen.text !== stages.at(-1)?.text) {
      stages.push({ atSec: Number(((Date.now() - started) / 1000).toFixed(2)), text: seen.text });
      log(`${stages.at(-1).atSec}s  ${seen.text}`);
    }
    badge = seen ?? badge;
    ready = /what.s outside/i.test(seen?.text ?? '');
    if (/couldn|retry|not enough/i.test(seen?.text ?? '')) {
      break;
    }
    await page.waitForTimeout(40);
  }
  if (!ready) {
    throw new Error(`the badge never became ready (last: ${stages.at(-1)?.text ?? 'no badge'})`);
  }

  // Airbnb greets a new visitor with a note about translation, which is closed. Its cookie banner
  // is left unanswered: nothing is accepted, and it sits below the part of the page the film shows.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click({ timeout: 5_000 }).catch(() => log('no translation note'));
  // Let late photos and fonts settle, then take the page with the badge and without it.
  await page.mouse.move(WIDTH - 40, HEIGHT - 40);
  await page.waitForTimeout(1500);
  badge = (await readBadge(page)) ?? badge;
  await page.screenshot({ path: join(shots, 'listing-ready.png') });
  await page.evaluate(() => {
    document.querySelector('outside-badge').style.visibility = 'hidden';
  });
  await page.screenshot({ path: join(shots, 'listing.png') });
  await page.evaluate(() => {
    document.querySelector('outside-badge').style.visibility = '';
  });

  // The real click, to see how the full view sits on the page.
  await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
  await page.waitForSelector('iframe[src*="player.html"]', { timeout: 10_000 });
  await page.waitForTimeout(2500);
  const frame = await page.evaluate(() => {
    const box = document.querySelector('iframe[src*="player.html"]').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.screenshot({ path: join(shots, 'overlay.png') });

  writeFileSync(
    join(data, 'capture.json'),
    `${JSON.stringify({ listing, viewport: { width: WIDTH, height: HEIGHT }, interests: INTERESTS, takenAt: new Date().toISOString(), title: await page.title(), badge, overlay: frame, stages }, null, 2)}\n`,
  );
  log('saved', shots);
} finally {
  await context.close();
}
