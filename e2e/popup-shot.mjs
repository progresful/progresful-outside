/**
 * Opens the built extension's popup on its own and saves a screenshot of it.
 *
 *   node e2e/popup-shot.mjs [output.png]          default: e2e/out/popup.png
 *
 * INTERESTS=food,adventure,nature picks interests first. EXTENSION=release uses the release build
 * (apps/extension/dist-release), which talks to the hosted server. CHROMIUM=<binary> names a browser.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const build = process.env.EXTENSION === 'release' ? 'dist-release' : 'dist';
const extension = join(here, '..', 'apps', 'extension', build, 'chrome-mv3');
const output = resolve(process.argv[2] ?? join(here, 'out', 'popup.png'));
mkdirSync(dirname(output), { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'outside-e2e-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  viewport: { width: 360, height: 470 },
  deviceScaleFactor: 2,
  args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  if (process.env.INTERESTS) {
    await worker.evaluate((picked) => chrome.storage.sync.set({ interests: picked }), process.env.INTERESTS.split(','));
  }
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: output });
  process.stdout.write(`${output}\n`);
} finally {
  await context.close();
}
