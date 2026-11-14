import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const site = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = readFileSync(join(site, 'index.html'), 'utf8');
const css = readFileSync(join(site, 'css', 'site.css'), 'utf8');

/** Every address the page or its stylesheet points a browser at. */
function references(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}
const pageLinks = references(html, /\s(?:src|href|data-src)="([^"]+)"/g);
const styleLinks = references(css, /url\('([^']+)'\)/g);
const local = (address) => address.startsWith('/') && !address.startsWith('//');

describe('the landing page', () => {
  it('has every file it asks for, apart from the download the bundle step makes', () => {
    const wanted = [...pageLinks, ...styleLinks].filter(local).filter((address) => !address.startsWith('/download/'));

    expect(wanted.length).toBeGreaterThan(10);
    expect(wanted.filter((address) => !existsSync(join(site, address)))).toEqual([]);
  });

  it('loads nothing from another site: the server only allows its own files', () => {
    const loaded = references(html, /<(?:script|link|img|audio|video|source|iframe)\b[^>]*\s(?:src|href|data-src)="([^"]+)"/g);
    const elsewhere = loaded.filter((address) => !local(address) && address !== 'https://outside.pgf.lv/');

    expect(elsewhere).toEqual([]);
    expect(styleLinks.filter((address) => !local(address))).toEqual([]);
  });

  it('carries no inline style or script, which that same rule would silently drop', () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(references(html, /<script\b([^>]*)>/g).filter((attributes) => !attributes.includes('src='))).toEqual([]);
  });

  it('has the picture it gives to sites that preview a link', () => {
    const picture = html.match(/property="og:image" content="https:\/\/outside\.pgf\.lv(\/[^"]+)"/)?.[1];

    expect(picture).toBeDefined();
    expect(existsSync(join(site, picture))).toBe(true);
  });

  it('names every button that shows only a picture', () => {
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const unnamed = buttons.filter(([, attributes, inner]) => !attributes.includes('aria-label=') && inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim() === '');

    expect(buttons.length).toBeGreaterThan(10);
    expect(unnamed).toEqual([]);
    // Its words are hidden on a phone, so the one over the video needs a name of its own.
    expect(html).toMatch(/<button class="hint"[^>]*aria-label="Play with sound"/);
  });

  it('offers the extension under the name the bundle step gives it', () => {
    expect(html.match(/href="\/download\/outside-extension\.zip" download/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the example video on the page', () => {
  const scenes = [...html.matchAll(/<article class="scene[^"]*" data-start="([\d.]+)" data-end="([\d.]+)" data-cues="([^"]*)"/g)].map((match) => ({
    start: Number(match[1]),
    end: Number(match[2]),
    cues: JSON.parse(match[3].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#x27;', "'")),
  }));

  it('runs from the first second to the last without a gap', () => {
    expect(scenes.length).toBe(6);
    expect(scenes[0].start).toBe(0);
    for (let index = 1; index < scenes.length; index += 1) {
      expect(scenes[index].start).toBe(scenes[index - 1].end);
    }
  });

  it('lets the slider reach exactly the end, in steps a keyboard can use', () => {
    const slider = html.match(/<input class="scrub"[^>]*>/)?.[0] ?? '';

    expect(Number(slider.match(/max="([\d.]+)"/)?.[1])).toBe(scenes.at(-1).end);
    // A fixed step would stop short of an end that is not a multiple of it.
    expect(slider).toContain('step="any"');
  });

  it('speaks every caption inside its own scene, and stays under thirty seconds', () => {
    for (const scene of scenes) {
      expect(scene.cues.length).toBeGreaterThan(0);
      for (const cue of scene.cues) {
        expect(cue.t).toBeGreaterThanOrEqual(scene.start);
        expect(cue.t).toBeLessThan(scene.end);
      }
    }
    expect(scenes.at(-1).end).toBeLessThanOrEqual(30);
  });

  it('shows only one scene to start with, and loads only its photo straight away', () => {
    expect(html.match(/class="scene[^"]* is-active"/g)?.length).toBe(1);
    expect(html.match(/<img src="\/demo\/img\//g)?.length).toBe(1);
    expect(html.match(/<img data-src="\/demo\/img\//g)?.length).toBe(5);
  });
});
