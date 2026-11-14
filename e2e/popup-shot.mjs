/** Opens the built extension's popup page on its own and saves a screenshot to e2e/out/popup.png. */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const extension = join(here, '..', 'apps', 'extension', 'dist', 'chrome-mv3');
mkdirSync(join(here, 'out'), { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'outside-e2e-')), {
  headless: false,
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  viewport: { width: 360, height: 520 },
  args: ['--headless=new', '--mute-audio', // the check reads the player's clock; nobody needs to hear it
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(here, 'out', 'popup.png') });
  process.stdout.write(`${await page.locator('body').innerText()}\n`);
} finally {
  await context.close();
}
