/**
 * Checks the landing page in a real browser: it loads cleanly on a desktop and a phone, the
 * download is there, the example video plays by itself and with its voice, and the small
 * controls work. Screenshots go to e2e/out.
 *
 *   pnpm check:site                         against http://127.0.0.1:8787
 *   SITE_URL=https://outside.pgf.lv pnpm check:site
 *
 * Set CHROMIUM=<path to a Chromium binary> to use one other than Playwright's own.
 * The browser is headless and muted.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const site = (process.env.SITE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) {
    failures.push(name);
  }
};

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--headless=new', '--mute-audio', '--autoplay-policy=document-user-activation-required'],
});

async function visit(label, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${site}/`, { waitUntil: 'load' });
  check(`${label}: headline`, (await page.locator('h1').innerText()).replace(/\s+/g, ' ').includes("See what's outside before you book."));
  check(`${label}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  const activeScene = () => page.evaluate(() => [...document.querySelectorAll('.scene')].findIndex((scene) => scene.classList.contains('is-active')));
  await page.waitForFunction(() => document.querySelector('.scene:nth-of-type(2)')?.classList.contains('is-active'), null, { timeout: 12_000 }).catch(() => undefined);
  check(`${label}: the example plays by itself`, (await activeScene()) >= 1, `scene ${await activeScene()}`);
  // Between two scenes there is a moment with no caption; wait for the next words.
  await page.waitForFunction(() => (document.querySelector('[data-demo-caption]')?.textContent ?? '').length > 0, null, { timeout: 6_000 }).catch(() => undefined);
  check(`${label}: captions follow`, (await page.locator('[data-demo-caption]').innerText()).length > 0);

  return { page, context, problems };
}

// Desktop: the whole page, and everything that can be pressed.
{
  const { page, context, problems } = await visit('desktop', { width: 1440, height: 900 });

  await page.screenshot({ path: join(out, 'site-hero-desktop.png') });

  await page.locator('.stage [data-demo-sound]').click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('[data-demo-audio]');
    return audio && !audio.paused && audio.currentTime > 0.3;
  }, null, { timeout: 10_000 }).catch(() => undefined);
  const voice = await page.evaluate(() => {
    const audio = document.querySelector('[data-demo-audio]');
    return { playing: !audio.paused, time: audio.currentTime, sound: document.querySelector('[data-demo]').classList.contains('has-sound') };
  });
  check('desktop: plays with its voice from the top', voice.playing && voice.sound && voice.time > 0.3 && voice.time < 6, JSON.stringify(voice));
  await page.locator('[data-demo-toggle]').click();
  check('desktop: pause stops the voice', await page.evaluate(() => document.querySelector('[data-demo-audio]').paused));

  const download = await context.request.get(`${site}/download/outside-extension.zip`);
  check('desktop: the download is a zip', download.ok() && download.headers()['content-type'] === 'application/zip', `${download.status()} ${(await download.body()).length} bytes`);
  check('desktop: version shown', /Version \d+\.\d+\.\d+/.test(await page.locator('.fineprint').innerText()));

  await page.locator('#install').scrollIntoViewIfNeeded();
  await page.locator('[data-copy]').click();
  check('desktop: copies the extensions address', (await page.evaluate(() => navigator.clipboard.readText())) === 'chrome://extensions');

  const chips = page.locator('.chip[aria-pressed="false"]');
  await chips.nth(0).click();
  await chips.nth(0).click();
  // With five picked the rest say they are unavailable; press one anyway, as a visitor might.
  await chips.nth(0).click({ force: true });
  check('desktop: takes five interests and no sixth', (await page.locator('[data-interests-count]').innerText()) === '5 of 5 picked' && (await page.locator('.chip[aria-pressed="true"]').count()) === 5);
  check('desktop: says the rest cannot be picked', (await page.locator('.chip[aria-disabled="true"]').count()) === 7);

  // The slider: drag to the end with the keyboard, and the last scene is on.
  await page.locator('[data-demo-scrub]').focus();
  await page.keyboard.press('End');
  check('desktop: the slider reaches the last scene', await page.evaluate(() => document.querySelector('.scene:last-of-type').classList.contains('is-active')));

  // Everything arrives as it is scrolled to; walk the page so the full screenshot shows it all.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'site-desktop.png'), fullPage: true });
  check('desktop: nothing failed to load', problems.length === 0, problems.slice(0, 4).join(' | '));
  await context.close();
}

// Phone.
{
  const { page, context, problems } = await visit('phone', { width: 390, height: 844 });
  await page.screenshot({ path: join(out, 'site-hero-phone.png') });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'site-phone.png'), fullPage: true });
  check('phone: nothing failed to load', problems.length === 0, problems.slice(0, 4).join(' | '));
  await context.close();
}

await browser.close();
process.stdout.write(failures.length === 0 ? 'PASSED\n' : `FAILED: ${failures.join('; ')}\n`);
process.exit(failures.length === 0 ? 0 : 1);
