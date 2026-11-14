# Outside — Must Tier Implementation Plan

> Kept as it was written on 14 November 2026, before the build. Paths in it are the ones planned then;
> what was actually built, and where, is in the [README](../README.md) and [decisions.md](decisions.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that, on an Airbnb or Booking.com listing page, builds and plays a 10–30 s narrated video about the area around the listing from live web data, tuned to the user's interests and trip dates.

**Architecture:** An MV3 extension reads the listing from the page and talks, through its background worker, to a local Fastify server. The server gathers facts through Context.dev (plus Open-Meteo), selects them in code, has OpenAI write one voiceover line per scene, voices it with ElevenLabs, and returns a scene manifest. The extension plays the manifest live with Remotion Player in an extension-page iframe. No MP4 in this plan.

**Tech Stack:** pnpm workspace · TypeScript · Vitest · WXT + React (extension) · Fastify + zod (server) · better-sqlite3 · Remotion (`remotion`, `@remotion/player`) · `openai` · Context.dev REST · ElevenLabs REST · Playwright.

**Spec:** [design.md](design.md) — read it first. Mocks: https://claude.ai/artifact/1uacgqAPpeKmoGnrDSVMnj

**Scope:** spikes plus the spec's **Must** tier (§8). Should and Stretch (Street View, area guide, MP4 on demand, price-change chips, monitors, news, music) get their own plan once this one demos end to end.

## Global Constraints

- One cache TTL everywhere: `TTL_MS = 21_600_000` (6 h). Every Context.dev call sends `maxAgeMs: 21_600_000`. An entry's clock starts at its real fetch time (`now − cache_metadata.age_ms`).
- Interests: 12 presets, at most 5 picked, default set `['food', 'culture', 'nature']` when none picked.
- Video: 1280×720, 30 fps, 10–30 s (300–900 frames), target 20 s, voiceover budget 50 words.
- Every name, price, rating and time on screen is rendered from a fact record. Model output is voiceover lines only.
- The voiceover never says "open now", "right now", "today", "tonight", "this evening".
- API keys live only in the server `.env`. The extension ships none.
- Content scripts make no network calls; the background worker is the only network client. The server never fetches Airbnb or Booking.com pages.
- The extension must never throw into the host page. On any failure the badge is hidden or shows its error state.
- Every server response is `{ success: boolean, data: T | null, error: string | null }`. All server input is validated with zod.
- Context.dev worker pool: at most 20 concurrent requests.
- English only.
- UI tokens: paper `#FFFFFF`, ink `#111614`, muted `#5B6660`, card `#F3F5F3`, line `#D5DBD6`, track `#DDE2DE`, accent `#0E6B4A`. Card radius 14, control radius 10, control height 44. Fonts: Bricolage Grotesque 700 (wordmark, titles), Inter 400/500/600, bundled via `@fontsource`. No secondary metadata lines in the extension's own UI.
- Exact UI copy is listed in the task that owns it. Do not add copy.
- Code style: no mutation of inputs, functions under 50 lines, files under 400 lines, no hard-coded secrets.
- Library APIs: confirm against current docs (Context7) before first use of WXT, Remotion, Fastify plugins or the `openai` package.
- Commits: `<type>: <description>`; no attribution trailer.

## Review Focus

1. **Odd price strings** ("From $1,234.50 per person", "45,00 €", "Free", a bare "45") — a mis-parsed number must never reach the screen; unparseable prices drop the fact. Test in Task 9.
2. **Bad trip dates** (in the past, check-out before check-in, months away) — fall back to the coming 14 days and skip weather beyond the forecast range; never crash. Test in Task 10.
3. **Navigating to another listing mid-generation** — the old badge and its polling stop; listing A's result never appears on listing B. Test in Task 19.
4. **Opening hours that cross midnight, 24-hour places, closed days, missing hours** — open-now is right in the place's timezone or the chip is omitted. Test in Task 16.
5. **Vague location with no coordinates** ("Entire home in Portugal") — geocode through Maps or fail with the spec's message; never build a video for a guessed city. Test in Task 11.

---

## File map

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  .gitignore  .env.example
packages/shared/src/   interests.ts  listing.ts  facts.ts  manifest.ts  api.ts  index.ts
packages/video/src/    OutsideVideo.tsx  scenes/{Hook,Activity,Experiences,Stay,Outro}.tsx
                       openNow.ts  captions.ts  format.ts  index.ts  fixtures/sample-manifest.json
apps/server/src/       config.ts  app.ts  index.ts
                       routes/{health,videos}.ts
                       cache/{cacheStore,keys,dedupe}.ts
                       contextdev/client.ts
                       sources/{types,places,experienceSources,experiences,events,weather,tripWindow,price}.ts
                       pipeline/{normalize,select,script,validateScript,voice,timing,assemble,run}.ts
                       media/{mediaStore,mirror}.ts
                       jobs/jobStore.ts
apps/server/test/      mirrors src/; fixtures/contextdev/*.json
apps/extension/        wxt.config.ts
                       entrypoints/{background.ts,listing.content.tsx,popup/,player/}
                       src/sites/{types,airbnb,booking,index}.ts
                       src/{storage,messages,apiClient}.ts
                       src/badge/{Badge.tsx,badgeState.ts,mount.ts,session.ts}
                       src/overlay.ts
                       src/popup/{StatusCard,InterestGrid,SettingsView,statusCard}.tsx
                       test/fixtures/{airbnb-listing,booking-listing}.html
spikes/                sources.ts  player-probe/
docs/spikes/           2026-11-14-{sources,listing-extraction,player-in-page}.md
e2e/                   outside.spec.ts
```

---

### Task 1: Workspace and shared schemas

**Files:**
- Create: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `packages/shared/src/{interests,listing,facts,manifest,api,index}.ts`, `packages/shared/package.json` (name `@outside/shared`)
- Test: `packages/shared/test/schemas.test.ts`

**Interfaces — Produces:**

```ts
// interests.ts
export type InterestId = 'food'|'nightlife'|'culture'|'history'|'nature'|'water'|'adventure'|'family'|'wellness'|'shopping'|'events'|'gems';
export interface Interest { id: InterestId; label: string; shortLabel: string; mapsQueries: string[]; experienceKeywords: string[] }
export const INTERESTS: readonly Interest[];          // spec §6.5, in that order
export const MAX_INTERESTS = 5;
export const DEFAULT_INTERESTS: readonly InterestId[]; // ['food','culture','nature']
export function effectiveInterests(picked: readonly InterestId[]): InterestId[]; // [] → defaults; else first 5, de-duplicated

// listing.ts
export const ListingContextSchema; export type ListingContext = {
  site: 'airbnb'|'booking'; listingId: string; url: string; title: string; locationText: string;
  lat?: number; lng?: number; photos: string[] /* ≤5 */; checkIn?: string; checkOut?: string /* YYYY-MM-DD */;
  guests?: number; currency?: string };

// facts.ts
export type OpeningHours = Record<0|1|2|3|4|5|6, { open: string; close: string }[]>; // 0 = Sunday, 'HH:MM', 24 h = 00:00–24:00
export interface Source { id: string; label: string; url: string; fetchedAt: string /* ISO */ }
export interface PlaceFact { id: string; kind: 'place'; interest: InterestId; name: string; rating: number; reviewCount: number;
  lat: number; lng: number; imageUrl: string; distanceM: number; hours?: OpeningHours; timezone?: string; sourceId: string }
export interface ExperienceFact { id: string; kind: 'experience'; title: string; amount: number; currency: string;
  durationText?: string; rating?: number; url: string; imageUrl?: string; sourceId: string }
export interface EventFact { id: string; kind: 'event'; title: string; dateText: string; url: string; sourceId: string }
export interface WeatherFact { id: string; kind: 'weather'; tempMinC: number; tempMaxC: number; precipitationChance: number; sourceId: string }
export type Fact = PlaceFact | ExperienceFact | EventFact | WeatherFact;

// manifest.ts
export type SceneType = 'hook'|'activity'|'experiences'|'stay'|'outro';
export interface CaptionWord { text: string; startSec: number; endSec: number }
export interface Scene { type: SceneType; startFrame: number; durationInFrames: number; imageUrl?: string; title: string;
  subtitle?: string; items?: { title: string; detail: string }[]; captions: CaptionWord[]; factIds: string[];
  place?: { hours: OpeningHours; timezone: string } }
export const VideoManifestSchema; export type VideoManifest = { id: string; version: 1; fps: 30; width: 1280; height: 720;
  durationInFrames: number; audioUrl: string | null; scenes: Scene[]; sources: Source[]; oldestFetchedAt: string;
  listing: { title: string; locationText: string }; interests: InterestId[] };

// api.ts
export type ApiResult<T> = { success: true; data: T; error: null } | { success: false; data: null; error: string };
export type VideoStatus = 'queued'|'gathering'|'writing'|'voicing'|'ready'|'failed';
export const CreateVideoRequestSchema; // { listing: ListingContext, interests: InterestId[] (max 5) }
export interface CreateVideoResponse { videoId: string; status: VideoStatus; cached: boolean }
export interface VideoStatusResponse { status: VideoStatus; stage: string; progress: number; manifest?: VideoManifest; error?: string }
```

`shortLabel` values, in order: Food, Nightlife, Museums, History, Nature, Beaches, Adventure, Family, Wellness, Shopping, Live music, Hidden gems.

- [ ] **Step 1:** `git init -b main`; create the workspace files. `.env.example` lists `CONTEXT_DEV_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID=eleven_flash_v2_5`, `PORT=8787`, `DATA_DIR=./data`, `FIXTURE_MODE=off`. `.gitignore` covers `node_modules`, `.env`, `data/`, `.output`, `.wxt`, `dist`.
- [ ] **Step 2: Write the failing tests**

```ts
it('has 12 presets and caps picks at 5', () => {
  expect(INTERESTS).toHaveLength(12);
  expect(effectiveInterests([])).toEqual(['food', 'culture', 'nature']);
  expect(effectiveInterests(['food','food','water','gems','events','family','nature'])).toEqual(['food','water','gems','events','family']);
});
it('rejects a listing with more than 5 photos or a malformed date', () => {
  const base = { site: 'airbnb', listingId: '1', url: 'https://www.airbnb.com/rooms/1', title: 't', locationText: 'Lisbon, Portugal', photos: [] };
  expect(ListingContextSchema.safeParse(base).success).toBe(true);
  expect(ListingContextSchema.safeParse({ ...base, photos: Array(6).fill('https://a0.muscache.com/x.jpg') }).success).toBe(false);
  expect(ListingContextSchema.safeParse({ ...base, checkIn: '12/16/2026' }).success).toBe(false);
});
it('rejects a create request with 6 interests', () => { /* CreateVideoRequestSchema */ });
```

- [ ] **Step 3:** Run `pnpm --filter @outside/shared test` — expect FAIL (modules missing).
- [ ] **Step 4:** Implement the six files to the interfaces above.
- [ ] **Step 5:** Run the tests — expect PASS. `pnpm -r typecheck` — expect no errors.
- [ ] **Step 6:** `git add -A && git commit -m "chore: workspace and shared schemas"`, then `git switch -c feat/must-tier`.

---

### Task 2: Spike — which sources work through Context.dev

Throwaway code; the deliverables are a results doc and recorded fixtures. No TDD. Hard cap: 600 credits (read `key_metadata.credits_consumed` on every response and stop at the cap).

**Files:**
- Create: `spikes/sources.ts`, `docs/spikes/2026-11-14-sources.md`, `apps/server/test/fixtures/contextdev/*.json`

- [ ] **Step 1:** Write `spikes/sources.ts`: for three places (a major tourist city, a beach town, a rural or nature area) call each candidate once and print latency, credits, usable-item count and image hosts. Candidates:
  - **Places:** `POST /web/scrape` with `url: https://www.google.com/maps/search/<query near location>`, `formats: { parse: true }`, `parseParams: { type: 'prebuilt', parser: 'google-maps' }`.
  - **Experiences via search:** `POST /web/search` with `includeDomains: ['getyourguide.com','viator.com','tripadvisor.com','airbnb.com']`, `numResults: 5`; then `POST /web/scrape` with `formats: { json: true }` and the Task 9 schema on the top three URLs.
  - **Experiences via URL template:** `https://www.getyourguide.com/s/?q=<city>` and `https://www.viator.com/searchResults/all?text=<city>` with the same JSON extraction.
  - **Events:** search with `freshness: 'last_month'` for `events in <city> <Month YYYY>`, then JSON extraction on the top two; and `https://www.eventbrite.com/d/<country>--<city>/events/`.
- [ ] **Step 2:** Run `pnpm tsx spikes/sources.ts`. Save one raw response per call for the tourist city into `apps/server/test/fixtures/contextdev/` (`places-food.json`, `search-experiences.json`, `experience-page-1.json`, `search-events.json`, `event-page-1.json`).
- [ ] **Step 3:** Write `docs/spikes/2026-11-14-sources.md`: a keep/kill table (source, call, params, median latency, credits, usable items, verdict); the working URL templates and params; the **search response's field names** (results array, URL, title); the shape of `google_hours`; every image host seen.
- [ ] **Step 4:** Verify: the doc names at least one kept experience source and one kept event source with median latency under 12 s, or says plainly that none qualified. If none qualified for a kind, stop and raise it before Task 9/10.
- [ ] **Step 5:** `git commit -m "docs: source spike results and fixtures"`

---

### Task 3: Spike — reading a listing from the live page

**Files:**
- Create: `apps/extension/test/fixtures/{airbnb-listing,booking-listing}.html`, `docs/spikes/2026-11-14-listing-extraction.md`

- [ ] **Step 1:** Open one live Airbnb listing and one Booking.com listing (with dates in the URL). In DevTools, find where each `ListingContext` field lives, preferring JSON-LD and embedded state over DOM, then URL params (Airbnb `check_in`/`check_out`, Booking `checkin`/`checkout`).
- [ ] **Step 2:** Save each page's `document.documentElement.outerHTML` as the fixture; first line is an HTML comment with the source URL.
- [ ] **Step 3:** Write the doc: per site and per field, the selector or JSON path and one fallback; the gallery container selector for the badge; whether in-site navigation between listings reloads the document.
- [ ] **Step 4:** Verify: both fixtures contain title, location text and at least one photo URL reachable by the documented paths. Note explicitly if coordinates are absent on either site.
- [ ] **Step 5:** `git commit -m "docs: listing extraction spike and fixtures"`

---

### Task 4: Spike — Remotion Player inside the listing page

**Files:**
- Create: `spikes/player-probe/` (minimal WXT extension), `docs/spikes/2026-11-14-player-in-page.md`

- [ ] **Step 1:** Build a probe extension: a content script on Airbnb listing URLs injects a fixed, full-viewport `<iframe allow="autoplay; fullscreen">` whose `src` is an extension page listed in `web_accessible_resources`; that page plays a 3 s Remotion composition with an MP3 served from `http://localhost:8787`.
- [ ] **Step 2:** Load it unpacked, open a real listing, click to open. Check: the frame renders above the page, audio plays after the click, Esc and a close message remove it, the host page is unchanged afterwards.
- [ ] **Step 3:** Write the doc: pass/fail per check, any CSP or mixed-content error text, and the workaround used. **If the iframe cannot work**, the fallback for Task 20 is opening `player.html?videoId=…` in a new tab; record that decision here.
- [ ] **Step 4:** `git commit -m "docs: player-in-page spike"`

---

### Task 5: Server skeleton

**Files:**
- Create: `apps/server/src/{config,app,index}.ts`, `apps/server/src/routes/health.ts`, `apps/server/package.json` (name `@outside/server`)
- Test: `apps/server/test/{config,health}.test.ts`

**Interfaces — Produces:**

```ts
export interface Config { contextDevApiKey: string; openaiApiKey: string; openaiModel: string; elevenLabsApiKey: string;
  elevenLabsVoiceId: string; elevenLabsModelId: string; port: number; dataDir: string; fixtureMode: 'off'|'record'|'replay' }
export function loadConfig(env: NodeJS.ProcessEnv): Config;      // throws listing every missing key by name
export function ok<T>(data: T): ApiResult<T>; export function fail(error: string): ApiResult<never>;
export function buildApp(deps: AppDeps): FastifyInstance;         // AppDeps grows in Task 15
```

CORS allows origins matching `^chrome-extension://`. Rate limit: 60 requests per minute per IP. Body limit: 64 KB. Errors return the envelope with a generic message; details go to the server log only.

- [ ] **Step 1: Write the failing tests**

```ts
it('names every missing key', () => {
  expect(() => loadConfig({})).toThrow(/CONTEXT_DEV_API_KEY.*OPENAI_API_KEY.*ELEVENLABS_API_KEY/s);
});
it('health returns the envelope', async () => {
  const res = await buildApp(testDeps()).inject({ method: 'GET', url: '/api/health' });
  expect(res.json()).toEqual({ success: true, data: { status: 'ok' }, error: null });
});
it('allows an extension origin and rejects a web origin', async () => { /* access-control-allow-origin present / absent */ });
```

- [ ] **Step 2:** Run `pnpm --filter @outside/server test` — expect FAIL.
- [ ] **Step 3:** Implement with `fastify`, `@fastify/cors`, `@fastify/rate-limit`. `index.ts` loads `.env`, calls `loadConfig`, listens on `config.port`.
- [ ] **Step 4:** Run tests — expect PASS. Run `pnpm --filter @outside/server dev` and `curl localhost:8787/api/health` — expect the envelope.
- [ ] **Step 5:** `git commit -m "feat: server skeleton with config, envelope and health"`

---

### Task 6: Cache store, keys, in-flight dedupe

**Files:**
- Create: `apps/server/src/cache/{cacheStore,keys,dedupe}.ts`
- Test: `apps/server/test/cache.test.ts`

**Interfaces — Produces:**

```ts
export const TTL_MS = 21_600_000;
export interface CacheEntry<T> { value: T; fetchedAt: number }
export interface CacheStore {
  get<T>(key: string, now?: number): CacheEntry<T> | null;   // null once now >= fetchedAt + TTL_MS
  set<T>(key: string, value: T, opts: { fetchedAt: number }): void;
  delete(key: string): void;
  sweep(now?: number): number;                                 // deletes expired rows, returns how many
}
export function createSqliteCacheStore(path: string): CacheStore;   // ':memory:' in tests
export function videoKey(i: { site: string; listingId: string; interests: InterestId[]; checkIn?: string; checkOut?: string; templateVersion: number }): string;
export function scrapeKey(adapterId: string, params: Record<string, string | number>): string;   // both sha256 hex
export function createDeduper(): <T>(key: string, fn: () => Promise<T>) => Promise<T>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('expires 6 h after the real fetch time', () => {
  const s = createSqliteCacheStore(':memory:');
  s.set('k', { a: 1 }, { fetchedAt: 1_000 });
  expect(s.get('k', 1_000 + TTL_MS - 1)).toEqual({ value: { a: 1 }, fetchedAt: 1_000 });
  expect(s.get('k', 1_000 + TTL_MS)).toBeNull();
});
it('sweep removes only expired rows', () => { /* two rows, one expired → returns 1, other still readable */ });
it('videoKey ignores interest order and changes with dates', () => {
  const a = videoKey({ site: 'airbnb', listingId: '1', interests: ['food','nature'], templateVersion: 1 });
  expect(videoKey({ site: 'airbnb', listingId: '1', interests: ['nature','food'], templateVersion: 1 })).toBe(a);
  expect(videoKey({ site: 'airbnb', listingId: '1', interests: ['food','nature'], checkIn: '2026-12-12', checkOut: '2026-12-16', templateVersion: 1 })).not.toBe(a);
});
it('scrapeKey ignores param order', () => { /* {a:1,b:2} equals {b:2,a:1} */ });
it('dedupe runs fn once for concurrent callers and again after it settles', async () => { /* counter === 1, then 2 */ });
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement (`better-sqlite3`, one table `cache(key TEXT PRIMARY KEY, value TEXT, fetched_at INTEGER)`). **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: sqlite cache store, cache keys, in-flight dedupe"`

---

### Task 7: Context.dev client

**Files:**
- Create: `apps/server/src/contextdev/client.ts`
- Test: `apps/server/test/contextdev.client.test.ts`

**Interfaces — Produces:**

```ts
export interface ScrapeOutput<T> { requested: boolean; success: boolean | null; data: T | null; error_code?: string; message?: string }
export interface ScrapeResponse { url: string; parsed: ScrapeOutput<{ results?: unknown[] }>; json: ScrapeOutput<unknown>;
  images: ScrapeOutput<{ url: string; width?: number; height?: number; classification?: string }[]>;
  cache_metadata: { status: 'hit'|'miss'|'zdr'; age_ms: number }; key_metadata?: { credits_consumed: number } }
export interface ContextDevClient {
  scrape(body: Record<string, unknown>): Promise<ScrapeResponse>;
  search(body: Record<string, unknown>): Promise<unknown>;      // shape per docs/spikes/2026-11-14-sources.md
}
export function createContextDevClient(o: { apiKey: string; fetch?: typeof fetch; maxConcurrent?: number;
  fixtures?: { mode: 'off'|'record'|'replay'; dir: string } }): ContextDevClient;
export class CreditsExhaustedError extends Error {}
export function realFetchedAt(res: { cache_metadata?: { age_ms?: number } }, now: number): number;   // now − age_ms, or now
```

Base URL `https://api.context.dev/v1`; paths `/web/scrape`, `/web/search`; header `Authorization: Bearer <key>`. Default `maxConcurrent` 20. Scrape bodies get `maxAgeMs: 21_600_000` and `timeoutOpts: { milliseconds: 12_000, behavior: 'fail' }` unless the caller set them. On 429, wait `Retry-After` seconds plus up to 250 ms jitter; at most 3 attempts. On 402 throw `CreditsExhaustedError`. Fixture file name: sha256 of path + body; `record` writes after a real call, `replay` never calls `fetch` and throws if the file is missing.

- [ ] **Step 1: Write the failing tests** (inject a fake `fetch`; fake timers for retries)

```ts
it('sends the bearer key and the 6 h maxAgeMs', async () => { /* body.maxAgeMs === 21_600_000; headers.authorization === 'Bearer k' */ });
it('keeps a caller-supplied maxAgeMs', async () => { /* maxAgeMs: 0 stays 0 */ });
it('retries a 429 after Retry-After and then succeeds', async () => { /* fetch called twice */ });
it('throws CreditsExhaustedError on 402', async () => {});
it('never has more than maxConcurrent calls in flight', async () => { /* maxConcurrent: 2, 5 calls, peak === 2 */ });
it('replay returns the recorded file without calling fetch', async () => {});
it('realFetchedAt subtracts the reported age', () => { expect(realFetchedAt({ cache_metadata: { age_ms: 5_000 } }, 20_000)).toBe(15_000); });
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: context.dev client with retry, pool and fixture mode"`

---

### Task 8: Places source

**Files:**
- Create: `apps/server/src/sources/{types,places}.ts`
- Test: `apps/server/test/sources.places.test.ts` (uses `fixtures/contextdev/places-food.json`)

**Interfaces:**
- Consumes: `ContextDevClient`, `CacheStore`, `scrapeKey`, `createDeduper`, `realFetchedAt`.
- Produces:

```ts
// types.ts
export interface LatLng { lat: number; lng: number }
export interface SourceResult<F> { facts: F[]; source: Source | null }
export interface SourceDeps { client: ContextDevClient; cache: CacheStore; dedupe: ReturnType<typeof createDeduper>; now: () => number; fetch: typeof fetch }
// places.ts
export function placesUrl(query: string, locationText: string): string;   // https://www.google.com/maps/search/<encodeURIComponent(`${query} near ${locationText}`)>
export function haversineM(a: LatLng, b: LatLng): number;
export function parseGoogleHours(raw: unknown): OpeningHours | null;      // input shape recorded in the source spike
export function toPlaceFact(raw: unknown, interest: InterestId, origin: LatLng, sourceId: string): PlaceFact | null;
export function fetchPlaces(deps: SourceDeps, p: { interest: InterestId; locationText: string; origin: LatLng }): Promise<SourceResult<PlaceFact>>;
```

`toPlaceFact` returns null when name, rating, coordinates or image is missing. `id` is `place:<place_id>`; `timezone` comes from `tz-lookup(lat, lng)`. `fetchPlaces` uses the interest's first `mapsQueries` entry, caches under `scrapeKey('places', { interest, lat: round2(origin.lat), lng: round2(origin.lng) })` with `fetchedAt = realFetchedAt(res, now)`, and labels the source "Google Maps".

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the maps search url', () => {
  expect(placesUrl('food market', 'Lisbon, Portugal')).toBe('https://www.google.com/maps/search/food%20market%20near%20Lisbon%2C%20Portugal');
});
it('maps a fixture record to a PlaceFact with distance and timezone', () => { /* name, rating, reviewCount, distanceM > 0, timezone defined */ });
it('drops a record with no image or no rating', () => {});
it('parses 24 h and split-shift hours', () => { /* 00:00–24:00; two ranges on one day */ });
it('serves the second call from cache without calling the client', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: google maps places source"`

---

### Task 9: Experiences source and price parsing

**Files:**
- Create: `apps/server/src/sources/{price,experienceSources,experiences}.ts`
- Test: `apps/server/test/sources.{price,experiences}.test.ts`

**Interfaces — Produces:**

```ts
export function parsePrice(text: string | number | null | undefined, currencyHint?: string | null): { amount: number; currency: string } | null;
export function formatPrice(amount: number, currency: string): string;   // Intl 'en', no decimals for whole amounts → '€45'
export const EXPERIENCE_SCHEMA: object;   // { experiences: [{ title, price, currency, duration, rating, reviewCount, url, image }] }; all but title nullable
export const EXPERIENCE_SOURCES: { id: string; label: string; domains: string[]; urlTemplate?: string }[];   // the kept rows from the source spike
export function fetchExperiences(deps: SourceDeps, p: { city: string; country: string; interests: InterestId[]; window: TripWindow }): Promise<SourceResult<ExperienceFact>[]>;
```

`parsePrice` rules: recognise `€ $ £` and ISO codes (`EUR 45`, `45 EUR`, `US$30`); accept `1,234.50` and `45,00`; for a range take the lower bound; return null for "Free", for no digits, and for a number with no currency and no `currencyHint`. `fetchExperiences`: search `"<first interest's first experienceKeyword> <city>"` restricted to the kept domains, scrape the top three results with JSON extraction (`jsonParams.instructions: 'Use only prices shown on the page.'`), drop items whose price does not parse or that have no URL, cache each page under `scrapeKey('experience-page', { url })`. `TripWindow` comes from Task 10 (declare the type there first if building in order).

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['€45', null, { amount: 45, currency: 'EUR' }],
  ['From $1,234.50 per person', null, { amount: 1234.5, currency: 'USD' }],
  ['45,00 €', null, { amount: 45, currency: 'EUR' }],
  ['US$30', null, { amount: 30, currency: 'USD' }],
  ['£12–£18', null, { amount: 12, currency: 'GBP' }],
  ['45', 'EUR', { amount: 45, currency: 'EUR' }],
  ['45', null, null], ['Free', null, null], ['', null, null], [null, null, null],
])('parsePrice(%j, %j)', (text, hint, expected) => expect(parsePrice(text, hint)).toEqual(expected));
it('formats whole and fractional amounts', () => { expect(formatPrice(45, 'EUR')).toBe('€45'); expect(formatPrice(12.5, 'USD')).toBe('$12.50'); });
it('turns the fixture page into ExperienceFacts and drops unpriced items', async () => {});
it('returns an empty result, not a throw, when the search fails', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: experiences source with strict price parsing"`

---

### Task 10: Trip window, events and weather

**Files:**
- Create: `apps/server/src/sources/{tripWindow,events,weather}.ts`
- Test: `apps/server/test/sources.{tripWindow,events,weather}.test.ts`

**Interfaces — Produces:**

```ts
export interface TripWindow { start: string; end: string; fromListing: boolean }   // YYYY-MM-DD
export function resolveTripWindow(l: Pick<ListingContext, 'checkIn'|'checkOut'>, today: string): TripWindow;
export function fetchEvents(deps: SourceDeps, p: { city: string; country: string; window: TripWindow }): Promise<SourceResult<EventFact>>;
export function fetchWeather(deps: SourceDeps, p: LatLng & { window: TripWindow; today: string }): Promise<SourceResult<WeatherFact>>;
```

`resolveTripWindow`: use the listing's dates only when both are valid, `checkOut > checkIn` and `checkOut >= today`; a stay already under way starts today; otherwise `start = today`, `end = today + 14 days`, `fromListing: false`. `fetchEvents` follows the kept event source from the spike, same pattern as experiences, keyed `scrapeKey('events', { city, start, end })`. `fetchWeather` calls `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=…&end_date=…&timezone=auto`, clamps `end` to `today + 15 days`, returns no facts when `start` is more than 15 days out, and reduces to one fact (min of mins, max of maxes, max precipitation chance), source label "Open-Meteo".

- [ ] **Step 1: Write the failing tests**

```ts
const today = '2026-11-14';
it('keeps valid listing dates', () => expect(resolveTripWindow({ checkIn: '2026-12-12', checkOut: '2026-12-16' }, today)).toEqual({ start: '2026-12-12', end: '2026-12-16', fromListing: true }));
it('falls back when dates are past, reversed or missing', () => {
  const fallback = { start: '2026-11-14', end: '2026-11-28', fromListing: false };
  expect(resolveTripWindow({ checkIn: '2026-10-01', checkOut: '2026-10-05' }, today)).toEqual(fallback);
  expect(resolveTripWindow({ checkIn: '2026-12-16', checkOut: '2026-12-12' }, today)).toEqual(fallback);
  expect(resolveTripWindow({}, today)).toEqual(fallback);
});
it('starts today for a stay already under way', () => expect(resolveTripWindow({ checkIn: '2026-11-10', checkOut: '2026-11-20' }, today).start).toBe(today));
it('returns no weather for a stay more than 15 days out, without calling fetch', async () => {});
it('reduces daily values to one fact', async () => { /* min 8, max 17, chance 60 from a stubbed response */ });
it('returns no events, not a throw, when extraction fails', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: trip window, events and weather sources"`

---

### Task 11: Normalise the place and select facts

**Files:**
- Create: `apps/server/src/pipeline/{normalize,select}.ts`
- Test: `apps/server/test/pipeline.{normalize,select}.test.ts`

**Interfaces — Produces:**

```ts
export interface NormalizedPlace { city: string; country: string; locationText: string; lat: number; lng: number }
export function splitLocation(locationText: string): { city: string; country: string };   // first and last comma part; one part → both
export function normalizePlace(deps: SourceDeps, listing: ListingContext): Promise<NormalizedPlace | null>;
export const MIN_PLACES = 3;
export function scorePlace(p: PlaceFact): number;   // rating * Math.log10(reviewCount + 1) / (1 + distanceM / 1000)
export function selectPlaces(places: PlaceFact[], interests: InterestId[]): PlaceFact[];
export function travelLabel(distanceM: number): string;
```

`normalizePlace`: with coordinates, use them. Without, scrape Maps for `locationText` and take the first result's coordinates; no result → null. `selectPlaces`: keep rating ≥ 4.2, reviews ≥ 50, within 3 000 m; if fewer than 3 remain, widen to 25 000 m; then take the best-scoring place for each interest in pick order, fill to 3 by score, never the same place twice. `travelLabel`: up to 2 000 m → `≈ N min walk` with `N = ceil(distanceM * 1.3 / 80)`; beyond → `≈ N min drive` with `N = ceil(distanceM * 1.3 / 500)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('uses listing coordinates when present', async () => { /* client not called */ });
it('geocodes a location with no coordinates through Maps', async () => { /* "Sintra, Portugal" → coords of first result */ });
it('returns null for a location Maps cannot resolve', async () => { /* "Entire home in Portugal", empty results → null */ });
it('filters by rating, reviews and radius, widening when thin', () => {});
it('takes one place per interest in pick order, then fills by score', () => {});
it('never returns more than 3 or the same place twice', () => {});
it('labels walking and driving', () => { expect(travelLabel(800)).toBe('≈ 13 min walk'); expect(travelLabel(9000)).toBe('≈ 24 min drive'); });
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: place normalisation and fact selection"`

---

### Task 12: Script with accuracy guard

**Files:**
- Create: `apps/server/src/pipeline/{script,validateScript}.ts`
- Test: `apps/server/test/pipeline.script.test.ts`

**Interfaces — Produces:**

```ts
export interface PlannedScene { type: SceneType; factIds: string[] }
export interface StoryScene extends PlannedScene { line: string }
export interface Selection { place: NormalizedPlace; window: TripWindow; places: PlaceFact[]; experiences: ExperienceFact[]; events: EventFact[]; weather: WeatherFact[] }
export function planScenes(sel: Selection): PlannedScene[];
export type Complete = (system: string, user: string, jsonSchema: object) => Promise<unknown>;   // injected; real one wraps the openai package
export function writeLines(complete: Complete, plan: PlannedScene[], facts: Map<string, Fact>, wordBudget: number): Promise<string[]>;
export function validateLines(lines: string[], plan: PlannedScene[], facts: Map<string, Fact>, wordBudget: number): { ok: true } | { ok: false; reasons: string[] };
export function templateLines(plan: PlannedScene[], facts: Map<string, Fact>, place: NormalizedPlace): string[];
export function scriptWithGuard(complete: Complete, sel: Selection, wordBudget?: number): Promise<StoryScene[]>;   // default 50
```

`planScenes` order: `hook`; one `activity` per selected place; `experiences` when at least one (up to 3 fact ids, cheapest first); `stay` when an event or weather fact exists (event preferred, else weather); `outro`. The model is asked for `{ lines: string[] }` (strict JSON schema), one line per planned scene, given only the referenced facts. `validateLines` rejects: wrong line count; any number in a line that is not a number in that scene's facts (rating, amount, temperatures, review count, travel minutes); any of `open now`, `right now`, `today`, `tonight`, `this evening` (case-insensitive); a line over 22 words; total over `wordBudget + 10`. `scriptWithGuard`: write → validate → one retry with the reasons appended → `templateLines`. Real `complete`: Chat Completions with `response_format: { type: 'json_schema', … strict: true }`, model from config, 15 s timeout.

- [ ] **Step 1: Write the failing tests**

```ts
it('plans hook, activities, experiences, stay, outro in order', () => {});
it('omits experiences and stay when there are no such facts', () => {});
it('accepts lines whose numbers all come from the facts', () => {});
it('rejects an invented price', () => { /* fact amount 45, line says "from 39 euros" → reasons mention 39 */ });
it('rejects time-sensitive words', () => { /* "open now", "tonight" */ });
it('rejects the wrong number of lines', () => {});
it('retries once, then falls back to the template', async () => {
  const complete = vi.fn().mockResolvedValue({ lines: ['open now'] });
  const scenes = await scriptWithGuard(complete, selection);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(validateLines(scenes.map((s) => s.line), planScenes(selection), factMap(selection), 50)).toEqual({ ok: true });
});
it('falls back to the template when the model call throws', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: voiceover script with fact-only validation and template fallback"`

---

### Task 13: Voice and scene timing

**Files:**
- Create: `apps/server/src/pipeline/{voice,timing}.ts`
- Test: `apps/server/test/pipeline.{voice,timing}.test.ts`

**Interfaces — Produces:**

```ts
export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export function synthesize(deps: { fetch: typeof fetch; apiKey: string; voiceId: string; modelId: string }, lines: string[]): Promise<{ audio: Buffer; alignment: Alignment }>;
export interface SceneTiming { startFrame: number; durationInFrames: number; captions: CaptionWord[] }
export const FPS = 30; export const MIN_FRAMES = 300; export const MAX_FRAMES = 900;
export function sceneTimings(lines: string[], alignment: Alignment): SceneTiming[];
export function silentTimings(lines: string[]): SceneTiming[];   // 2.5 words per second, same padding rules
export function totalFrames(t: SceneTiming[]): number;
```

`synthesize`: one request, `POST https://api.elevenlabs.io/v1/text-to-speech/<voiceId>/with-timestamps?output_format=mp3_44100_128`, header `xi-api-key`, body `{ text: lines.join('\n'), model_id }`; decode `audio_base64`; throw on non-200 or a null `alignment`. `sceneTimings`: line *i* owns the characters at its offsets in the joined text; a scene runs from where the previous one ended to its last character's end plus 0.25 s; the last scene gets 0.5 s more; frames are `Math.round(sec * 30)`; if the total is under 300, the last scene is extended to reach 300. Caption words are whitespace-split, timed from their first and last characters. Totals over 900 are the caller's problem (Task 15).

- [ ] **Step 1: Write the failing tests**

```ts
const align = (text: string, per = 0.05): Alignment => ({ characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i * per), character_end_times_seconds: [...text].map((_, i) => (i + 1) * per) });
it('gives contiguous scenes that cover the audio', () => {
  const lines = ['Step outside in Lisbon.', 'Food first.'];
  const t = sceneTimings(lines, align(lines.join('\n')));
  expect(t[1].startFrame).toBe(t[0].startFrame + t[0].durationInFrames);
  expect(t[0].captions.map((c) => c.text)).toEqual(['Step', 'outside', 'in', 'Lisbon.']);
});
it('extends a short video to 300 frames', () => { expect(totalFrames(sceneTimings(['Hi.'], align('Hi.')))).toBe(300); });
it('silent timing uses 2.5 words per second', () => { /* 5 words → 2 s + 0.25 s pad before the 300-frame floor */ });
it('sends xi-api-key and the joined text', async () => {});
it('throws when alignment is null', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: elevenlabs voice with timestamp-driven scene timing"`

---

### Task 14: Media store, image mirror, manifest assembly

**Files:**
- Create: `apps/server/src/media/{mediaStore,mirror}.ts`, `apps/server/src/pipeline/assemble.ts`
- Test: `apps/server/test/{media.mirror,pipeline.assemble}.test.ts`

**Interfaces — Produces:**

```ts
export interface MediaStore { put(name: string, data: Buffer): Promise<string>;   // returns '/media/<name>'
  sweep(now?: number): Promise<number> }                                           // deletes files older than TTL_MS
export function createDiskMediaStore(dir: string): MediaStore;
export const IMAGE_HOST_ALLOWLIST: readonly string[];   // 'muscache.com', 'bstatic.com', 'googleusercontent.com', plus every image host listed in the source spike doc
export function isAllowedImageUrl(url: string): boolean;   // https, hostname equal to or a subdomain of an allowlisted host
export function mirrorImage(deps: { fetch: typeof fetch; media: MediaStore }, url: string): Promise<string | null>;
export function assembleManifest(i: { id: string; listing: ListingContext; interests: InterestId[]; sel: Selection; scenes: StoryScene[];
  timings: SceneTiming[]; audioUrl: string | null; images: Map<string, string>; sources: Source[] }): VideoManifest;
```

`mirrorImage` returns null (never throws) for a disallowed URL, a non-200, a redirect, a content type outside `image/*`, or a body over 8 MB; file name is sha256 of the URL plus the extension from the content type. `assembleManifest` scene text:

| type | title | subtitle | items |
|---|---|---|---|
| hook | `Around <city>` | trip dates as `12–16 Dec` when `window.fromListing`, else none | — |
| activity | place name | `<rating to 1 dp> rating · <travelLabel>` | — |
| experiences | `Experiences nearby` | — | up to 3: `{ title, detail: 'from <formatPrice>' }` |
| stay | `During your stay` when `fromListing`, else `In the next two weeks` | event: `<title> · <dateText>`; weather: `<min>–<max> °C, <chance>% chance of rain` | — |
| outro | `What's outside` | none (the player adds the "as of" line) | source labels as `{ title: label, detail: '' }` |

Images: hook uses the first listing photo; activity uses the place image; experiences uses the first experience image; a scene whose image did not mirror falls back to the first listing photo, then to none. Activity scenes carry `place: { hours, timezone }` when both exist. `oldestFetchedAt` is the earliest `fetchedAt` among sources; `durationInFrames` is the timings' total.

- [ ] **Step 1: Write the failing tests**

```ts
it('allows only https urls on allowlisted hosts', () => {
  expect(isAllowedImageUrl('https://a0.muscache.com/im/x.jpg')).toBe(true);
  expect(isAllowedImageUrl('http://a0.muscache.com/im/x.jpg')).toBe(false);
  expect(isAllowedImageUrl('https://a0.muscache.com.evil.com/x.jpg')).toBe(false);
  expect(isAllowedImageUrl('https://127.0.0.1/x.jpg')).toBe(false);
});
it('mirrors an image and returns its media path', async () => {});
it('returns null for html, oversize, redirect and non-200', async () => {});
it('builds scene text from facts', () => { /* activity subtitle '4.7 rating · ≈ 13 min walk'; experiences item detail 'from €45' */ });
it('falls back to the listing photo when a place image did not mirror', () => {});
it('sets oldestFetchedAt to the earliest source time and sums duration', () => {});
it('validates against VideoManifestSchema', () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: media store, safe image mirror, manifest assembly"`

---

### Task 15: Pipeline runner, jobs, video routes

**Files:**
- Create: `apps/server/src/pipeline/run.ts`, `apps/server/src/jobs/jobStore.ts`, `apps/server/src/routes/videos.ts`
- Modify: `apps/server/src/{app,index}.ts` (wire deps, serve `/media` statically, sweep cache and media every 10 minutes)
- Test: `apps/server/test/{pipeline.run,routes.videos}.test.ts`

**Interfaces — Produces:**

```ts
export const TEMPLATE_VERSION = 1;
export class NotEnoughDataError extends Error {}   // message: 'Not enough live data for this area'
export interface StageUpdate { status: VideoStatus; stage: string; progress: number }
export interface PipelineDeps extends SourceDeps { complete: Complete; media: MediaStore; today: () => string;
  synthesize: (lines: string[]) => Promise<{ audio: Buffer; alignment: Alignment }> }
export function runPipeline(deps: PipelineDeps, input: { listing: ListingContext; interests: InterestId[] }, onStage: (u: StageUpdate) => void): Promise<VideoManifest>;
export interface Job extends VideoStatusResponse { id: string; key: string }
export function createJobStore(): { get(id: string): Job | undefined; getByKey(key: string): Job | undefined; put(job: Job): void };
```

Stages, in order: `gathering` "Reading the neighbourhood" (0.1) → `gathering` "Finding <shortLabel, lower case> spots" once per interest (0.2–0.5) → `gathering` "Checking live prices" (0.6) → `writing` "Writing the script" (0.7) → `voicing` "Recording voiceover" (0.85) → `ready` (1). Places, experiences, events and weather run in parallel; a source that throws or times out contributes nothing — except `CreditsExhaustedError`, which is logged at error level and fails the job. Fewer than `MIN_PLACES` selected, or `normalizePlace` null → `NotEnoughDataError`. Voice: if `totalFrames > MAX_FRAMES`, rerun the script with `wordBudget` 40 once; if still over, drop the lowest-scoring activity scene and voice again. If `synthesize` throws, use `silentTimings` and `audioUrl: null`.

Routes: `POST /api/videos` validates with `CreateVideoRequestSchema`, applies `effectiveInterests`, computes `videoKey` (`videoId` = its first 16 hex chars). A cached manifest → `{ status: 'ready', cached: true }`. A job in flight for the key → that job. Otherwise start one. `GET /api/videos/:id` returns the job, or the cached manifest as `ready`, or 404 with the envelope. A finished manifest is stored under the video key with `fetchedAt = now`.

- [ ] **Step 1: Write the failing tests** (stub every source, `complete`, `synthesize`)

```ts
it('emits stages in order and returns a valid manifest', async () => {});
it('still succeeds when experiences and events throw', async () => { /* no experiences or stay scene */ });
it('fails the job when a source reports exhausted credits', async () => { /* rejects with CreditsExhaustedError */ });
it('fails with the exact message when fewer than 3 places survive', async () => {
  await expect(runPipeline(depsWithPlaces(2), input, () => {})).rejects.toThrow('Not enough live data for this area');
});
it('returns a silent manifest when voice fails', async () => { /* audioUrl === null */ });
it('shortens once, then drops an activity scene, to stay within 900 frames', async () => {});
it('POST twice concurrently runs one pipeline and returns one videoId', async () => {});
it('POST after ready reports cached: true', async () => {});
it('POST with 6 interests returns 400 and the envelope', async () => {});
it('GET of a failed job carries the error and status failed', async () => {});
it('GET of an unknown id is 404', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** With real keys in `.env`, run the server and `curl -X POST localhost:8787/api/videos` with a hand-written Lisbon listing; poll the `GET` until `ready`. Expected: a manifest with at least hook, three activities, outro, and a playable `/media/*.mp3`. Note the cold time in the commit body.
- [ ] **Step 6:** `git commit -m "feat: video pipeline, jobs and routes"`

---

### Task 16: Video composition

**Files:**
- Create: `packages/video/src/{OutsideVideo.tsx,openNow.ts,captions.ts,format.ts,index.ts}`, `packages/video/src/scenes/*.tsx`, `packages/video/src/fixtures/sample-manifest.json`, `packages/video/package.json` (name `@outside/video`)
- Test: `packages/video/test/{openNow,captions,format}.test.ts`

**Interfaces — Produces:**

```ts
export function isOpenNow(hours: OpeningHours, timezone: string, now: Date): boolean;
export function activeCaption(words: CaptionWord[], timeSec: number, windowWords?: number): string;   // default 6 words around the spoken one
export function asOfLabel(iso: string, locale?: string): string;   // 'Live data as of 14 Nov, 02:14'
export const OutsideVideo: React.FC<{ manifest: VideoManifest; mediaBase: string }>;
```

`OutsideVideo` lays each scene out in a Remotion `<Sequence>` at its `startFrame`, plays `audioUrl` when present, and resolves relative media against `mediaBase`. Scene layout follows the "Full-view player" mock: full-bleed image, title bottom-left in Bricolage Grotesque 700, subtitle under it, caption line at the bottom. Activity scenes append ` · Open now` to the subtitle when `place` exists and `isOpenNow(place.hours, place.timezone, new Date())`; nothing otherwise. Outro shows `asOfLabel(manifest.oldestFetchedAt)` and the source labels. A scene with no image renders on `#39413C`. Motion is the builder's choice.

- [ ] **Step 1: Write the failing tests**

```ts
const hours = (d: number, open: string, close: string): OpeningHours => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], [d]: [{ open, close }] }) as OpeningHours;
it('is open inside the range and closed outside it', () => {
  expect(isOpenNow(hours(5, '09:00', '17:00'), 'Europe/Lisbon', new Date('2026-11-13T12:00:00Z'))).toBe(true);   // Friday
  expect(isOpenNow(hours(5, '09:00', '17:00'), 'Europe/Lisbon', new Date('2026-11-13T18:00:00Z'))).toBe(false);
});
it('handles a range that crosses midnight', () => {
  expect(isOpenNow(hours(5, '18:00', '02:00'), 'Europe/Lisbon', new Date('2026-11-14T01:00:00Z'))).toBe(true);   // Saturday 01:00, opened Friday
});
it('handles 24-hour places and closed days', () => {
  expect(isOpenNow(hours(6, '00:00', '24:00'), 'Europe/Lisbon', new Date('2026-11-14T03:00:00Z'))).toBe(true);
  expect(isOpenNow(hours(5, '09:00', '17:00'), 'Europe/Lisbon', new Date('2026-11-15T12:00:00Z'))).toBe(false);  // Sunday
});
it('uses the place timezone, not the viewer clock', () => {
  expect(isOpenNow(hours(6, '09:00', '17:00'), 'Asia/Tokyo', new Date('2026-11-14T01:00:00Z'))).toBe(true);     // 10:00 Saturday in Tokyo
});
it('returns the words around the spoken one', () => {});
it('formats the as-of label', () => { expect(asOfLabel('2026-11-14T02:14:00Z', 'en-GB')).toMatch(/^Live data as of 14 Nov/); });
```

- [ ] **Step 2:** Run `pnpm --filter @outside/video test` — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Run Remotion Studio on `OutsideVideo` with `sample-manifest.json`. Expected: every scene type appears, text is legible over a photo and over no photo, audio and captions stay in step.
- [ ] **Step 6:** `git commit -m "feat: remotion composition with play-time open-now"`

---

### Task 17: Site adapters

**Files:**
- Create: `apps/extension/src/sites/{types,airbnb,booking,index}.ts`, `apps/extension/package.json` (name `@outside/extension`), `apps/extension/wxt.config.ts`
- Test: `apps/extension/test/sites.test.ts` (jsdom, the two fixture pages)

**Interfaces — Produces:**

```ts
export interface SiteAdapter { site: 'airbnb'|'booking';
  matchListing(url: string): { listingId: string } | null;
  extractListing(doc: Document, url: string): ListingContext | null;   // null when title or location text is missing
  findGallery(doc: Document): Element | null }
export function adapterFor(url: string): { adapter: SiteAdapter; listingId: string } | null;
```

Airbnb matches `https://<any>.airbnb.<tld>/rooms/<digits>`; Booking matches `https://www.booking.com/hotel/<cc>/<slug>[.<lang>].html` with `listingId` = `<cc>/<slug>`. Field paths and the gallery selector come from `docs/spikes/2026-11-14-listing-extraction.md`. Dates come from URL params (`check_in`/`check_out`, `checkin`/`checkout`). Extraction never throws.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['https://www.airbnb.com/rooms/12345?check_in=2026-12-12&check_out=2026-12-16', 'airbnb', '12345'],
  ['https://www.airbnb.co.uk/rooms/12345', 'airbnb', '12345'],
  ['https://www.booking.com/hotel/pt/some-hotel.en-gb.html?checkin=2026-12-12', 'booking', 'pt/some-hotel'],
])('matches %s', (url, site, id) => { const m = adapterFor(url)!; expect([m.adapter.site, m.listingId]).toEqual([site, id]); });
it.each(['https://www.airbnb.com/s/Lisbon/homes', 'https://www.booking.com/searchresults.html?ss=Lisbon', 'https://example.com/rooms/1'])
  ('ignores %s', (url) => expect(adapterFor(url)).toBeNull());
it('reads title, location, photos and dates from the Airbnb fixture', () => { /* photos.length between 1 and 5; checkIn from the url */ });
it('reads the same from the Booking fixture', () => {});
it('returns null, not a throw, for an empty document', () => {});
it('finds the gallery container in both fixtures', () => {});
```

- [ ] **Step 2:** Run `pnpm --filter @outside/extension test` — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: airbnb and booking listing adapters"`

---

### Task 18: Settings storage, messages, background worker

**Files:**
- Create: `apps/extension/src/{storage,messages,apiClient}.ts`, `apps/extension/entrypoints/background.ts`
- Test: `apps/extension/test/{storage,apiClient}.test.ts`

**Interfaces — Produces:**

```ts
export interface Settings { interests: InterestId[]; sites: { airbnb: boolean; booking: boolean }; serverUrl: string }
export const DEFAULT_SETTINGS: Settings;   // interests [], both sites true, 'http://localhost:8787'
export function getSettings(): Promise<Settings>; export function saveSettings(patch: Partial<Settings>): Promise<Settings>;   // interests capped at 5
export function onSettingsChanged(cb: (s: Settings) => void): () => void;
export type Message = { type: 'video:create'; listing: ListingContext; interests: InterestId[] } | { type: 'video:status'; videoId: string } | { type: 'server:health' };
export function createApiClient(fetchFn: typeof fetch, serverUrl: () => Promise<string>): {
  createVideo(body: { listing: ListingContext; interests: InterestId[] }): Promise<ApiResult<CreateVideoResponse>>;
  getVideo(id: string): Promise<ApiResult<VideoStatusResponse>>; health(): Promise<ApiResult<{ status: string }>> };
```

The API client never throws: a network error or a non-JSON body becomes `{ success: false, data: null, error: 'unreachable' }`. `background.ts` routes each `Message` to the client and returns the result. Manifest permissions: `storage`; host permissions for `*://*.airbnb.com/*`, the other Airbnb TLDs the adapter matches, `https://www.booking.com/*`, `http://localhost/*`.

- [ ] **Step 1: Write the failing tests**

```ts
it('returns defaults when storage is empty', async () => {});
it('caps saved interests at 5', async () => {});
it('turns a rejected fetch into an unreachable result', async () => {
  const api = createApiClient(vi.fn().mockRejectedValue(new Error('down')), async () => 'http://localhost:8787');
  expect(await api.health()).toEqual({ success: false, data: null, error: 'unreachable' });
});
it('posts the create body as json to <serverUrl>/api/videos', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** `git commit -m "feat: extension settings, messages and background api client"`

---

### Task 19: Listing session and badge

**Files:**
- Create: `apps/extension/src/badge/{badgeState.ts,session.ts,Badge.tsx,mount.ts}`, `apps/extension/entrypoints/listing.content.tsx`
- Test: `apps/extension/test/{badgeState,session}.test.ts`

**Interfaces — Produces:**

```ts
export type BadgeState = { kind: 'hidden' } | { kind: 'generating'; stage: string } | { kind: 'ready'; videoId: string }
  | { kind: 'refreshing'; videoId: string } | { kind: 'error' };
export type BadgeEvent = { type: 'status'; videoId: string; res: ApiResult<VideoStatusResponse> } | { type: 'unreachable' } | { type: 'restart' };
export function nextBadgeState(prev: BadgeState, ev: BadgeEvent): BadgeState;
export function createListingSession(deps: { send: (m: Message) => Promise<unknown>; render: (s: BadgeState) => void;
  getSettings: () => Promise<Settings>; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }): { start(listing: ListingContext): void; restart(): void; stop(): void };
export const POLL_MS = 1500;
export function mountBadge(gallery: Element | null, onPlay: (videoId: string) => void, onRetry: () => void): { render(s: BadgeState): void; remove(): void };
```

Reducer: a status of `queued`/`gathering`/`writing`/`voicing` → `generating` with its stage (or `refreshing` if a video was ready before the restart); `ready` → `ready`; `failed` → `error`; `unreachable` → `hidden`; `restart` from `ready` → `refreshing` with the old `videoId`. `session.stop()` cancels the timer and marks the session dead so late replies are ignored. The content script starts a session on load and on every URL change (WXT's location-change event), stops the previous one first, skips sites switched off in settings, and calls `restart()` when interests change.

Badge, per the mocks: white pill, height 56, radius 28, shadow `0 6px 20px rgba(17,22,20,.22)`, inside an open shadow root whose host element is `<outside-badge>`, absolutely placed 16 px from the gallery's bottom-left; with no gallery, fixed 24 px from the viewport's bottom-right. Copy: generating "Building video" over the stage; ready "What's outside"; refreshing "What's outside" over "Updating"; error "Couldn't build video" and a "Retry" button.

- [ ] **Step 1: Write the failing tests**

```ts
it('maps server statuses to badge states', () => { /* gathering → generating with stage; ready → ready; failed → error */ });
it('hides when the server is unreachable', () => {});
it('keeps the old video playable while refreshing', () => {
  const s = nextBadgeState({ kind: 'ready', videoId: 'a' }, { type: 'restart' });
  expect(s).toEqual({ kind: 'refreshing', videoId: 'a' });
});
it('polls every 1500 ms until ready, then stops', async () => { /* fake timers; send called for create, then status ×n */ });
it('ignores a late reply after stop and leaves no timer running', async () => {
  const render = vi.fn(); const session = createListingSession(depsWithSlowSend(render));
  session.start(listingA); session.stop();
  await flushSlowSend();
  expect(render).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'ready' }));
  expect(vi.getTimerCount()).toBe(0);
});
it('starting listing B after A renders only B results', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement reducer and session, then `Badge.tsx`, `mount.ts`, the content script. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Load the extension (`pnpm --filter @outside/extension dev`) with the server running; open a real listing. Expected: the pill appears on the gallery, stages change, it ends on "What's outside"; navigating to another listing replaces it; the page's own console shows no errors from the extension.
- [ ] **Step 6:** `git commit -m "feat: listing session and on-page badge"`

---

### Task 20: Player page and overlay

**Files:**
- Create: `apps/extension/entrypoints/player/{index.html,main.tsx,PlayerApp.tsx}`, `apps/extension/src/overlay.ts`
- Modify: `apps/extension/wxt.config.ts` (`web_accessible_resources` for the player page), `apps/extension/entrypoints/listing.content.tsx` (badge `onPlay` opens the overlay)
- Test: `apps/extension/test/overlay.test.ts`

**Interfaces — Produces:**

```ts
export function createOverlay(doc: Document, playerUrl: (videoId: string) => string, extensionOrigin: string): { open(videoId: string): void; close(): void; isOpen(): boolean };
```

`open` adds one fixed, full-viewport iframe (`allow="autoplay; fullscreen"`, top z-index) pointing at `player.html?videoId=…`; a second `open` replaces it. It closes on a `{ type: 'outside:close' }` message **from the extension origin only**, and on `close()`. The player page loads the manifest from the server, renders `@remotion/player`'s `<Player>` with `OutsideVideo` at 960×540 on a `#0E1210` backdrop, autoplays, and draws its own controls per the mock: close (top right), pause/play, seek bar, mute, fullscreen — no time readout. It posts `outside:close` when playback ends, on Esc, on the close button and on a backdrop click. If the player spike chose the new-tab fallback, `open` calls `window.open(playerUrl(videoId))` instead and the rest of this task applies to the tab.

- [ ] **Step 1: Write the failing tests**

```ts
it('opens one iframe for the video', () => { /* src contains videoId=abc; second open leaves exactly one iframe */ });
it('closes on a close message from the extension origin', () => {});
it('ignores a close message from another origin', () => { /* still open */ });
it('close() removes the iframe', () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement overlay, then the player page. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** On a real listing: click the badge. Expected: full-view video with sound; Esc, ✕ and the end of the video each return to the untouched listing.
- [ ] **Step 6:** `git commit -m "feat: full-view player overlay"`

---

### Task 21: Popup

**Files:**
- Create: `apps/extension/entrypoints/popup/{index.html,main.tsx}`, `apps/extension/src/popup/{Popup.tsx,StatusCard.tsx,InterestGrid.tsx,SettingsView.tsx,statusCard.ts}`
- Modify: `apps/extension/entrypoints/listing.content.tsx` (answer `{ type: 'badge:get' }` with the current `BadgeState` and location text; handle `{ type: 'player:open' }`)
- Test: `apps/extension/test/popup.test.tsx` (Testing Library)

**Interfaces — Produces:**

```ts
export type CardModel = { title: string; subtitle: string; action?: 'play' | 'retry'; progress?: boolean };
export function statusCardFor(i: { firstRun: boolean; onListing: boolean; serverUp: boolean; badge?: BadgeState; locationText?: string }): CardModel;
```

Popup is 360 px wide, matching the approved mocks exactly: header (mark, "Outside", settings icon), one status card, "Your interests" with an "n of 5" counter and a 3-column grid of 44 px chips using `shortLabel`. Card copy, in priority order:

| Condition | Title | Subtitle | Action |
|---|---|---|---|
| server down | Can't reach the server | Check that it's running. | Retry |
| first run (no interests saved yet) | See what's outside every listing | Pick up to 5 interests to shape the video. | — |
| not a listing tab | No listing in this tab | Open one on Airbnb or Booking.com. | — |
| generating / refreshing | Building your video | the current stage | progress bar |
| ready | Video ready | the listing's location text | Play |
| error | Couldn't build video | Try again. | Retry |

Selected chips: accent fill, white text. At five picks the rest are disabled at 40% opacity. Settings view: back arrow, "Settings", "Active on" with "Airbnb" and "Booking.com" switches, "Server URL" field. Nothing else.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  [{ firstRun: false, onListing: true, serverUp: false }, "Can't reach the server"],
  [{ firstRun: true, onListing: true, serverUp: true }, "See what's outside every listing"],
  [{ firstRun: false, onListing: false, serverUp: true }, 'No listing in this tab'],
  [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'generating', stage: 'Checking live prices' } }, 'Building your video'],
  [{ firstRun: false, onListing: true, serverUp: true, badge: { kind: 'ready', videoId: 'a' }, locationText: 'Lisbon, Portugal' }, 'Video ready'],
])('statusCardFor %j → %s', (input, title) => expect(statusCardFor(input as never).title).toBe(title));
it('toggles a chip and updates the counter', async () => { /* click Food → "1 of 5", aria-pressed true */ });
it('disables unpicked chips at five', async () => {});
it('saves interests through saveSettings', async () => {});
it('settings switches save per-site flags', async () => {});
```

- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Compare the running popup with the mock frames side by side in each state. Expected: same layout, copy and colours.
- [ ] **Step 6:** `git commit -m "feat: popup with status card, interests and settings"`

---

### Task 22: End to end, and how to run it

**Files:**
- Create: `e2e/outside.spec.ts`, `playwright.config.ts`, `README.md`
- Modify: `apps/server/src/index.ts` (when `E2E=1`, wire the template script and silent timings instead of OpenAI and ElevenLabs)

- [ ] **Step 1: Write the failing test.** Playwright launches Chromium with the built extension, starts the server with `FIXTURE_MODE=replay` and stubbed script and voice (env `E2E=1` swaps in the template script and silent timings), and serves the Airbnb fixture for `https://www.airbnb.com/rooms/12345?check_in=2026-12-12&check_out=2026-12-16` through `context.route`.

```ts
test('listing page → badge → video → back to listing', async () => {
  await page.goto(listingUrl);
  const badge = page.locator('outside-badge');                       // the shadow host's tag
  await expect(badge.getByText('Building video')).toBeVisible();
  await expect(badge.getByText("What's outside")).toBeVisible({ timeout: 20_000 });
  await badge.getByRole('button').click();
  await expect(page.locator('iframe[src*="player.html"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe[src*="player.html"]')).toHaveCount(0);
});
test('search page shows no badge', async () => { /* /s/Lisbon/homes → outside-badge count 0 */ });
```

- [ ] **Step 2:** Run `pnpm e2e` — expect FAIL until wiring is complete; fix wiring only, not behaviour covered by unit tests.
- [ ] **Step 3:** Run `pnpm e2e` — expect PASS. Run `pnpm -r test -- --coverage` — expect all green and at least 80% line coverage in `apps/server`, `packages/shared`, `packages/video` pure modules and `apps/extension/src`.
- [ ] **Step 4:** Write `README.md`: prerequisites, `.env` keys, `pnpm install`, `pnpm dev` (server and extension), loading the unpacked extension, fixture mode, and a demo checklist (open the demo listings within 6 h beforehand to warm the cache; switch to `FIXTURE_MODE=replay` if the network fails).
- [ ] **Step 5:** Full manual pass with real keys on one Airbnb and one Booking.com listing. Record cold and cached time-to-playable in the README against the 40 s and 2 s targets.
- [ ] **Step 6:** `git commit -m "test: end-to-end flow and run instructions"`

---

## Not in this plan

Street View scenes, area guide, MP4 on demand, price-change chips, Context.dev monitors, news item, background music, more sites. Each is additive: a new source adapter, scene type or route on the interfaces above.
