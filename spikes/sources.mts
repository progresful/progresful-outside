/**
 * Throwaway spike: which sources return clean data through Context.dev.
 * Run: pnpm --filter @outside/server exec tsx --env-file=../../.env ../../spikes/sources.mts <probe...>
 * Raw responses land in spikes/out/ (git-ignored). Stops at CREDIT_CAP.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://api.context.dev/v1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const CREDIT_CAP = 600;
const key = process.env.CONTEXT_DEV_API_KEY ?? '';
let spent = 0;

export const EXPERIENCE_SCHEMA = {
  type: 'object',
  properties: {
    experiences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: ['string', 'null'] },
          currency: { type: ['string', 'null'] },
          duration: { type: ['string', 'null'] },
          rating: { type: ['number', 'null'] },
          reviewCount: { type: ['number', 'null'] },
          url: { type: ['string', 'null'] },
          image: { type: ['string', 'null'] },
        },
        required: ['title'],
      },
    },
  },
  required: ['experiences'],
};

export const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          date: { type: ['string', 'null'] },
          venue: { type: ['string', 'null'] },
          price: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
          image: { type: ['string', 'null'] },
        },
        required: ['title'],
      },
    },
  },
  required: ['events'],
};

async function call(name: string, path: string, body: Record<string, unknown>): Promise<unknown> {
  if (spent >= CREDIT_CAP) {
    console.log(`SKIP ${name}: credit cap reached`);
    return null;
  }
  const started = Date.now();
  let status = 0;
  let json: unknown = null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch (error: unknown) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : 'unknown'}`);
    return null;
  }
  const ms = Date.now() - started;
  const meta = (json as { key_metadata?: { credits_consumed?: number; credits_remaining?: number } } | null)?.key_metadata;
  spent += meta?.credits_consumed ?? 0;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(json, null, 2));
  console.log(`${name}: status ${status}, ${ms} ms, credits ${meta?.credits_consumed ?? '?'} (spent ${spent}, left ${meta?.credits_remaining ?? '?'})`);
  return status === 200 ? json : null;
}

function summarizeJson(name: string, json: unknown, field: 'experiences' | 'events'): void {
  const out = (json as { json?: { success?: boolean; data?: Record<string, unknown[]> } } | null)?.json;
  const items = (out?.data?.[field] ?? []) as Array<Record<string, unknown>>;
  const priced = items.filter((item) => typeof item.price === 'string' && /\d/.test(item.price));
  const hosts = new Set(
    items.flatMap((item) => {
      try {
        return typeof item.image === 'string' ? [new URL(item.image).hostname] : [];
      } catch {
        return [];
      }
    }),
  );
  console.log(`  ${name}: success=${out?.success} items=${items.length} priced=${priced.length} withUrl=${items.filter((i) => i.url).length} imageHosts=${[...hosts].join(',')}`);
  for (const item of items.slice(0, 4)) {
    console.log(`    - ${JSON.stringify({ t: item.title, p: item.price, c: item.currency, d: item.duration ?? item.date, r: item.rating, u: String(item.url ?? '').slice(0, 70) })}`);
  }
}

const scrapeJson = (name: string, url: string, schema: object, instructions: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
  call(name, '/web/scrape', {
    url,
    formats: { json: true },
    jsonParams: { schema, instructions },
    timeoutOpts: { milliseconds: 30_000, behavior: 'fail' },
    ...(process.env.SPIKE_COUNTRY ? { sharedParams: { country: process.env.SPIKE_COUNTRY } } : {}),
    ...extra,
  });

const EXP_INSTR = 'List the bookable tours and activities shown on this page. Use only prices shown on the page.';
const EVT_INSTR = 'List the upcoming events shown on this page with their dates exactly as shown.';

const PROBES: Record<string, (city: string, country: string) => Promise<void>> = {
  async places(city, country) {
    const res = await call(`places-food-${city}`, '/web/scrape', {
      url: `https://www.google.com/maps/search/${encodeURIComponent(`food market near ${city}, ${country}`)}`,
      formats: { parse: true },
      parseParams: { type: 'prebuilt', parser: 'google-maps' },
      timeoutOpts: { milliseconds: 30_000, behavior: 'fail' },
    });
    const results = ((res as { parsed?: { data?: { results?: Array<Record<string, unknown>> } } } | null)?.parsed?.data?.results ?? []);
    console.log(`  results=${results.length} keys=${Object.keys(results[0] ?? {}).join(',')}`);
    console.log(`  google_hours sample: ${JSON.stringify(results.find((r) => r.google_hours)?.google_hours)?.slice(0, 600)}`);
    console.log(`  open_status sample: ${JSON.stringify(results[0]?.open_status)}`);
  },
  async search(city) {
    const res = await call(`search-experiences-${city}`, '/web/search', {
      query: `food tour ${city}`,
      includeDomains: ['getyourguide.com', 'viator.com', 'tripadvisor.com', 'airbnb.com'],
      numResults: 10,
    });
    console.log(`  top-level keys: ${Object.keys((res as object | null) ?? {}).join(',')}`);
    console.log(`  ${JSON.stringify(res)?.slice(0, 1500)}`);
  },
  async gyg(city) {
    summarizeJson('gyg', await scrapeJson(`gyg-${city}`, `https://www.getyourguide.com/s/?q=${encodeURIComponent(city)}`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async viator(city) {
    summarizeJson('viator', await scrapeJson(`viator-${city}`, `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async tripadvisor(city) {
    summarizeJson('tripadvisor', await scrapeJson(`tripadvisor-${city}`, `https://www.tripadvisor.com/Search?q=${encodeURIComponent(`${city} tours`)}`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async airbnb(city, country) {
    summarizeJson('airbnb', await scrapeJson(`airbnb-${city}`, `https://www.airbnb.com/s/${encodeURIComponent(`${city}--${country}`)}/experiences`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async klook(city) {
    summarizeJson('klook', await scrapeJson(`klook-${city}`, `https://www.klook.com/search/result/?query=${encodeURIComponent(city)}`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async tiqets(city) {
    summarizeJson('tiqets', await scrapeJson(`tiqets-${city}`, `https://www.tiqets.com/en/search/?q=${encodeURIComponent(city)}`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async civitatis(city) {
    summarizeJson('civitatis', await scrapeJson(`civitatis-${city}`, `https://www.civitatis.com/en/${encodeURIComponent(city.toLowerCase().replace(/\s+/g, '-'))}/`, EXPERIENCE_SCHEMA, EXP_INSTR), 'experiences');
  },
  async eventbrite(city, country) {
    const slug = (text: string): string => text.toLowerCase().replace(/\s+/g, '-');
    summarizeJson('eventbrite', await scrapeJson(`eventbrite-${city}`, `https://www.eventbrite.com/d/${slug(country)}--${slug(city)}/events/`, EVENT_SCHEMA, EVT_INSTR), 'events');
  },
  async songkick(city) {
    summarizeJson('songkick', await scrapeJson(`songkick-${city}`, `https://www.songkick.com/search?query=${encodeURIComponent(city)}&type=upcoming`, EVENT_SCHEMA, EVT_INSTR), 'events');
  },
  async timeout(city) {
    summarizeJson('timeout', await scrapeJson(`timeout-${city}`, `https://www.timeout.com/${encodeURIComponent(city.toLowerCase())}/things-to-do`, EVENT_SCHEMA, EVT_INSTR), 'events');
  },
  async viatormd(city) {
    const res = await call(`viator-md-${city}`, '/web/scrape', {
      url: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}`,
      formats: { markdown: true },
      timeoutOpts: { milliseconds: 30_000, behavior: 'fail' },
      ...(process.env.SPIKE_COUNTRY ? { sharedParams: { country: process.env.SPIKE_COUNTRY } } : {}),
    });
    const md = String((res as { markdown?: { data?: unknown } } | null)?.markdown?.data ?? '');
    console.log(`  markdown length ${md.length}`);
  },
  async airbnbwait(city, country) {
    summarizeJson('airbnbwait', await scrapeJson(`airbnbwait-${city}`, `https://www.airbnb.com/s/${encodeURIComponent(`${city}--${country}`)}/experiences`, EXPERIENCE_SCHEMA, EXP_INSTR, { sharedParams: { waitFor: 4000, ...(process.env.SPIKE_COUNTRY ? { country: process.env.SPIKE_COUNTRY } : {}) } }), 'experiences');
  },
  async eventsearch(city) {
    const res = await call(`search-events-${city}`, '/web/search', { query: `events in ${city} November 2026`, freshness: 'last_month', numResults: 10 });
    console.log(`  ${JSON.stringify(res)?.slice(0, 1500)}`);
  },
};

const [city = 'Lisbon', country = 'Portugal', ...names] = process.argv.slice(2);
const chosen = names.length > 0 ? names : Object.keys(PROBES);
await Promise.all(
  chosen.map(async (name) => {
    const probe = PROBES[name];
    if (!probe) {
      console.log(`unknown probe ${name}`);
      return;
    }
    await probe(city, country);
  }),
);
console.log(`TOTAL credits spent this run: ${spent}`);
