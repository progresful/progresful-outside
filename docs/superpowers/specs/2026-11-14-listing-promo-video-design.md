# Outside — "what's around this listing" promo video extension

Design doc · 2026-11-14 · status: **approved 2026-11-14**
Working name "Outside" comes from the repo folder; rename freely.

Legend: **[decided]** = stated by the team. **[call]** = my choice, open to correction. **[verify]** = assumption to confirm in a spike before building on it.

---

## 1. Intent

Junction 2026, Context.dev challenge: *build a product that reacts to the live web.* Five criteria, 20% each: real-world impact, creative use of live web data, completeness of demo, technical execution (latency and accuracy), real-timeness.

A listing page sells the room, not the stay. Travelers leave the tab to research the area: what there is to do, what it costs, what is on during their dates. Outside answers that in place with a 10–30 second narrated video about the area around the listing, built from live web data and tuned to the traveler's interests.

**Who:** a traveler browsing Airbnb or Booking.com in desktop Chrome.

## 2. Goals, non-goals, anti-goals

**Goals**

1. Opening a full listing page starts generation automatically; a badge on the gallery shows progress and then the playable video. [decided]
2. Clicking the badge plays the video in a full-view overlay, then returns to the listing. [decided]
3. The video is personalised by interest tags picked from a preset. [decided]
4. Everything on screen comes from live web data that is at most 6 h old when the video is built, and the video states the real fetch time of its oldest fact. Every price or rating is traceable to a source.
5. Time to playable: target ≤ 40 s cold, ≤ 2 s cached. (My estimate of what is achievable; measure in spike 1.)
6. The whole thing runs end to end on one laptop against a local server. [decided]

**Non-goals (this weekend)**

- Accounts, payments, or booking inside the extension.
- Cloud deployment (storage and compute sit behind interfaces so it is a later swap). [decided]
- Listing sites beyond Airbnb and Booking.com; browsers beyond Chromium; mobile.
- Voiceover languages other than English. [call]
- Editing the video.

**Anti-goals — it fails even if it "works"**

- An invented place, price, or rating. One hallucinated price sinks the accuracy score.
- Breaking, slowing, or visually fighting the host page; covering gallery controls.
- A silent wait: the badge must show live progress from the first second.
- Any API key inside the extension.

## 3. Constraints

- **Context.dev is the web-data layer.** 50,000 credits, 50 concurrent requests. Budget: ≤ 100 credits per cold video.
- **Keys available:** Context.dev, ElevenLabs, OpenAI. **Google Maps key (Street View): being obtained** — the design works with or without it, and Street View switches on when the key is set.
- **Context.dev has no Street View output.** Street View needs Google's Street View Static API.
- **Context.dev caches up to three days by default.** Every call must set `maxAgeMs` ≤ 6 h or the "live" claim is false.
- **Do not server-scrape Airbnb/Booking listing pages** (bot protection, cost, latency). The extension already has the rendered page; it reads the listing from the DOM.
- **Demo assumption** [call]: the team runs it live on listings they choose, and a judge may ask for a listing of their own. So nothing is hard-coded to particular listings or cities; the demo listings are opened within 6 h beforehand to warm the cache; and the recorded-response fixture mode (§10) doubles as a fallback if the venue network fails.
- **Remotion licence:** free for individuals and companies of up to three people; larger companies need a paid licence. Fine for the hackathon; revisit before any commercial launch. (HyperFrames is Apache-2.0.)

## 4. Approaches

### 4.1 What form the video takes

| | How | Trade-off |
|---|---|---|
| A. Live playback | Server returns a scene manifest plus voice MP3; the overlay plays it with Remotion Player. | Playable as soon as data, script and voice are done. Tiny cache. No file to share. |
| B. Rendered MP4 | Server renders an MP4; overlay is a plain `<video>`. | Shareable file, simplest player. Adds an estimated 30–90 s per video on a laptop and renders one at a time. |
| **C. A, plus MP4 on demand** | Play live; render the MP4 only when the user asks to share or download. | Fast first play and a real file when wanted. Two code paths, but they share one composition. |

**Picked: C** [decided]. Latency is a judged criterion and the user may leave the listing before a rendered file exists. Build A first; the MP4 path is a "should".

### 4.2 Stack calls

| Area | Choice | Why |
|---|---|---|
| Video engine | **Remotion** [call] | One React composition drives both the in-browser Player (live playback) and the server renderer (MP4). HyperFrames' documented path is render-to-MP4 with a dev preview; I could not confirm an embeddable player. |
| Extension | Manifest V3, TypeScript, **WXT** [call] | Handles MV3 packaging, content-script UI in shadow DOM, and SPA URL-change events. |
| Server | Node + TypeScript, **Fastify**, zod [call] | Schema validation and rate limiting out of the box. |
| Storage | **SQLite file + local disk**, behind `CacheStore` and `MediaStore` interfaces [call] | TTL queries and price history are trivial; swapping to cloud later means new implementations of two interfaces. |
| Script writer | **OpenAI**, structured (JSON-schema) output, model name from env [call] | The key the team has. |
| Voice | **ElevenLabs Flash**, with-timestamps endpoint [decided: ElevenLabs fast model; call: timestamps] | Low latency; per-character timings let scenes cut on the voice and drive captions. |
| Repo | pnpm workspace: `apps/extension`, `apps/server`, `packages/video` (composition), `packages/shared` (zod schemas, interest presets) [call] | The manifest schema is shared by server, player and renderer. |

## 5. User experience

Visual design is the next step (mocks). This section fixes behaviour, not looks.

### 5.1 When it activates

- Airbnb: `https://*.airbnb.*/rooms/<id>` (full listing page).
- Booking.com: `https://www.booking.com/hotel/<cc>/<slug>.html`.
- Not on search or map pages. The map quick view is a card on a search URL, so it never matches. [decided]
- Both sites navigate without full reloads; the extension re-evaluates on every URL change and tears down the previous badge.

### 5.2 Badge

Anchored inside the listing's photo gallery, bottom-left of the hero image. If the gallery cannot be found, it falls back to a fixed bottom-right position. Rendered in a shadow root so page styles cannot leak in or out.

```
┌──────────────────────── listing gallery ────────────────────────┐
│                                         ┌───────┐ ┌───────┐     │
│        hero photo                       │ photo │ │ photo │     │
│                                         ├───────┤ ├───────┤     │
│  ┌──────────────────────────┐           │ photo │ │ photo │     │
│  │ ◔ Checking live prices…  │           └───────┘ └───────┘     │
│  └──────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘

ready:  ┌────────────────────┐
        │ (▶) What's outside │
        └────────────────────┘
```

| State | Shows |
|---|---|
| generating | Progress ring and the current stage in words: "Reading the neighbourhood", "Finding food spots", "Checking live prices", "Writing the script", "Recording voiceover". |
| ready | Play icon and "What's outside". Nothing else. |
| refreshing | After an interest or date change, the previous video stays playable while the new one builds. (After TTL expiry there is no previous video; the badge goes back to generating.) |
| error | One quiet line and a retry button. |
| offline | The server is unreachable: "Server not running" and a retry button. Changed from "hidden" on 2026-11-14 (see §12.6): a badge that vanished read as a broken extension. |
| hidden | No location could be read. The page is left untouched. |

### 5.3 Interests

- Twelve presets (table in §6.5). The user picks **up to five** [call: more than that dilutes a 20 s video].
- Stored in `chrome.storage.sync`. Edited in the toolbar popup. The badge carries no settings control. [call: keeps the badge minimal]
- First run, nothing picked: generation still starts, using a default "Highlights" set (food, art & museums, nature). [call — keeps "starts automatically" true]
- Changing interests on a listing page triggers a new generation for that listing (a different cache key, so a different video). [decided]

### 5.4 Player

- Click the badge → a full-viewport overlay above the page with a dark backdrop. The video autoplays with sound (the click is the user gesture that permits audio).
- Controls: play/pause, seek, mute, close (✕, Esc, backdrop click), true-fullscreen toggle.
- When the video ends, the overlay closes and the listing is back as it was. [decided]
- No end card. The video ends and the overlay closes straight away. [decided]
- Share/download button → MP4 on demand (§6.7). [should]

### 5.5 Video structure

Default length 20 s, hard range 10–30 s [decided]. 1280×720, 30 fps, landscape [call: matches the desktop gallery]. Scene lengths follow the voiceover, not a fixed grid.

| # | Scene | Content | Tier |
|---|---|---|---|
| 1 | Hook | "Around <place>", trip dates if known, and what the weather is usually like then (§12.7). Photo of the place in season when one is found, else the listing's hero photo. | must |
| 2 | Step outside | Street View of the street outside; falls back to a listing exterior photo. | should (key pending) |
| 3–5 | Activities | One per top interest: photo, name, rating and review count, approximate walk/drive time, open-now status. | must |
| 6 | Experiences | Two or three bookable experiences with live price, duration, rating, source. | must |
| 7 | During your stay | An event or the weather outlook for the trip dates. | must |
| 8 | Outro | "Live data as of <time>" and source names. | must |

Voiceover is roughly 2.5 words per second, so about 45–50 words for 20 s. Captions appear on screen, timed from the voice timestamps, so the video still works muted.

### 5.6 Look

Mocks: https://claude.ai/artifact/1uacgqAPpeKmoGnrDSVMnj — popup, badge and player all approved 2026-11-14.

- **Light theme** [decided]: white ground, near-black text, one dark-green accent. Bricolage Grotesque for the wordmark and titles, Inter for everything else.
- **Minimal by rule** [decided]: no small secondary data in the extension's own UI — no dates, durations, timestamps, server status or hint lines. One title, one subline, one action per surface. (The "as of" time lives in the video outro, §7.)
- **Popup:** header, one status card for the current tab (ready / building / no listing / server unreachable), interest grid with an "n of 5" counter. Settings view: per-site switches and server URL. No master on/off switch, no rebuild button.
- **Player:** dark backdrop behind the video [call: video convention; the mock has a light variant].

## 6. System

```
Listing page (Airbnb / Booking.com)
 ├─ content script: site adapter reads the listing; badge UI in shadow DOM
 └─ player iframe (an extension page): Remotion Player + manifest
        │ messages
 background service worker ── HTTP ──► local server (Fastify)
                                        ├─ /api/videos …        jobs, status, manifest
                                        ├─ pipeline             gather → select → script → voice → assemble
                                        ├─ source adapters      Context.dev (6 h cache), Street View, weather
                                        ├─ OpenAI, ElevenLabs
                                        ├─ CacheStore (SQLite), MediaStore (disk)
                                        └─ renderer             Remotion → MP4, on demand
```

### 6.1 Extension

**Site adapters.** One per site, same interface:

- `matchListing(url)` → `{ site, listingId }` or null.
- `extractListing(document, url)` → `ListingContext`:
  `site, listingId, url, title, locationText` (city / region / country as the page shows them), `lat, lng` (Airbnb's are deliberately approximate), up to five `photos`, and when present `checkIn, checkOut, guests, currency`.
- Sources, in order of preference: JSON-LD and embedded page state, then DOM, then URL parameters (Airbnb `check_in` / `check_out`, Booking `checkin` / `checkout`). [verify exact fields in spike 2]
- Adapters fail soft. Missing coordinates are resolved on the server from `locationText`. Missing location text hides the badge.

**Background service worker.** The only network client. Content scripts never call the server directly, which avoids the host page's CSP and CORS. The content script polls job status through it (each message wakes the worker, so MV3 idle shutdown is not a problem).

**Player page.** An extension page listed in `web_accessible_resources`, loaded in an iframe by the content script. Because it is an extension origin, the host page's CSP cannot block its scripts, audio, or images. [verify in spike 3]

**Popup.** One status card for the current tab, the interest picker, and a settings view with per-site on/off and the server URL (dev only). See §5.6.

**Permissions.** `storage`; host permissions for Airbnb and Booking domains and the server origin. Nothing else.

### 6.2 Server API

Every response uses one envelope: `{ success, data, error }`.

| Method and path | Purpose |
|---|---|
| `POST /api/videos` | Body `{ listing: ListingContext, interests: string[] }`. Returns `{ videoId, status, cached }`. Idempotent: the same key returns the same job, including one already in flight. |
| `GET /api/videos/:id` | `{ status, stage, progress, manifest?, error? }`. Status: `queued → gathering → writing → voicing → ready`, or `failed`. |
| `POST /api/videos/:id/render` | Start an MP4 render. Returns `{ renderId }`. [should] |
| `GET /api/renders/:id` | `{ status, progress, url? }`. [should] |
| `GET /media/:file` | Voice MP3s, mirrored images, MP4s. |
| `GET /api/health` | Liveness, and whether each key is configured. |

### 6.3 Caching

| What | Key | TTL |
|---|---|---|
| Video (manifest, voice, MP4) | hash of `site, listingId, sorted interests, checkIn, checkOut, template version` | **6 h** [decided; dates are in the key because the video is trip-date aware] |
| Scrape result | hash of `source adapter id, normalised params` | **6 h** [decided — one TTL for every cache] |

- Area-level sources are keyed by **city and interest**, not by listing, and nearby-place searches by coordinates rounded to about 1 km. Two listings in the same neighbourhood share scrapes, so the second video is much faster and cheaper.
- Concurrent requests for the same key share one in-flight call.
- Every Context.dev call sets `maxAgeMs` to 6 h. The response reports how old its copy is (`cache_metadata.age_ms`); our entry records the true fetch time and expires at 6 h minus that age. No scrape is ever used more than 6 h after it was really fetched.
- **What is promised at play time** [call, follows from the 6 h TTL on both caches]: data is at most 6 h old when a video is built, and a built video can be replayed for 6 h, so the oldest fact on a cached play can be up to 12 h old. The "as of" stamp is the real fetch time of the video's oldest fact, never the play time. Anything that would be wrong after hours rather than days (open-now) is computed at play time instead of being baked in (§7).
- An expired video is deleted, not shown stale: the next visit regenerates it.
- A sweep removes expired rows and media files. Before an experience price is removed it is copied to a small `price_history` table for price-change chips. [should]

### 6.4 Pipeline

**Stage 0 — Normalise.** Resolve `{ city, region, country, lat, lng }` from the listing context. No coordinates → look up `locationText` through the Google Maps source and take the first result's coordinates.

**Stage 1 — Gather.** All sources run in parallel, each with its own deadline (start at 12 s). The pipeline continues with whatever has arrived. Minimum to proceed: three usable places.

| Source | Gives | How | Est. credits |
|---|---|---|---|
| `places:<interest>` | Places with name, category, rating, review count, coordinates, price range, hours, open status, one photo | Context.dev scrape of a Google Maps search URL (`<interest query> near <location>`) with the prebuilt `google-maps` parser | ~1 per interest |
| `area-guide` | What the city, region and country are known for; what is good in the trip's month | Context.dev Answers in `fast` mode with a JSON shape and `return-partial` deadline. Keyed by city + month, so usually cached. Fallback: Search with highlights. | 10 |
| `experiences` | Bookable experiences: title, price, currency, duration, rating, URL, image | Context.dev Search limited to experience sites, then Scrape with JSON extraction (schema) on the top three pages | ~16 |
| `events` | What is on during the stay | Context.dev Search with `freshness`, then JSON extraction on the top one or two pages | ~6–11 |
| `images` | Better photos for chosen items that lack one | Context.dev Scrape images with dimensions + classification; keep `photography` ≥ 800 px wide | ~1 each |
| `street` | Street View stills at the listing and at chosen places | Google Street View Static API (metadata check first; skip if no coverage). Needs a Google key. | — |
| `weather` | Outlook for the trip dates | Open-Meteo (free, no key) | — |
| `news` | One notable local item: festival, strike, closure | Context.dev News search, last week | stretch |

Estimated total: about 40 credits per cold video, less with city-level cache hits. The Maps parser's price is not documented. [verify in spike 1]

**Candidate experience and event sites** [verify all in spike 1 — keep whatever returns clean data inside the deadline]: GetYourGuide, Viator, Tripadvisor attractions, Airbnb Experiences, Eventbrite, Wikivoyage ("See"/"Do" sections for the area guide). Each becomes a small source adapter: a URL template or search query, the params it accepts (location, dates, interest), and a JSON schema for extraction.

**Stage 2 — Select (code, not the model).** Places are filtered (rating ≥ 4.2, ≥ 50 reviews, has a photo, within 3 km, widening to 25 km when results are thin) and ranked by rating, review volume and distance. Up to three activity scenes, at least one from the user's first-picked interest. Distance is straight-line from the listing, shown as approximate walk or drive time.

**Stage 3 — Script (OpenAI).** Input: the selected facts, each with an id. Output: an ordered storyboard where each scene **references fact ids** and carries one voiceover line.

**The accuracy guard:** every name, price, rating and time shown on screen is rendered from the fact record, never from model text. The voiceover is validated — unknown ids or numbers that are not in the referenced facts are rejected; one retry, then a fixed template script built from the facts. The voiceover never states time-sensitive status ("open now", "today", "tonight"), because it is recorded once and replayed for hours. It may speak prices; the on-screen price carries the "as of" time.

**Stage 4 — Voice.** ElevenLabs Flash with timestamps → MP3 plus per-character timings. Each scene lasts as long as its line plus padding. If the total exceeds 30 s, regenerate once with a tighter word budget; if it still does, drop the lowest-ranked activity scene.

**Stage 5 — Assemble.** The server mirrors every scene image into its media store (HTTPS only, host allowlist, size and content-type checks), so the player loads everything from one origin, broken images are caught before "ready", and Street View URLs carrying the Google key never reach the client. Output is the **manifest**: dimensions, fps, duration, voice URL, scenes (type, start, length, image, text, chips, caption timings, fact ids), each place's opening hours and timezone, sources (label, URL, fetched-at), the oldest fetch time, listing summary, interests.

**Stage 6 — Ready.** Status flips; the badge shows the video.

### 6.5 Interest presets

| id | Label | Maps queries | Experience keywords |
|---|---|---|---|
| food | Food & drink | local restaurants, food market | food tour, cooking class, tasting |
| nightlife | Nightlife | cocktail bar, live music bar | pub crawl, night tour |
| culture | Art & museums | museum, art gallery | museum tickets, guided tour |
| history | History & architecture | historic landmark, old town | walking tour, heritage |
| nature | Nature & hikes | hiking trail, park, viewpoint | hike, day trip, national park |
| water | Beaches & water | beach, boat rental | boat tour, surf lesson, kayak |
| adventure | Adventure & sports | climbing, bike rental | rafting, zipline, bike tour |
| family | Family & kids | family attraction, zoo | family tickets, aquarium |
| wellness | Wellness & spa | spa, sauna, thermal bath | spa day, yoga |
| shopping | Shopping & markets | local market, shopping street | craft workshop, shopping tour |
| events | Live music & events | concert venue, theatre | concert tickets, show |
| gems | Hidden gems | locals' favourite, hidden gem | off the beaten path, local guide |

### 6.6 When things go wrong

| Failure | Behaviour |
|---|---|
| A source times out or errors | Its scene type is skipped; the rest proceeds. |
| Fewer than three usable places | Job fails with "Not enough live data for this area"; badge offers retry. |
| Context.dev 429 | Honour `Retry-After` with jitter; worker pool capped at 20, under the 50 limit. |
| Context.dev 402 (credits gone) | Loud server log; badge error. |
| Script model fails or fails validation twice | Template script from the facts. |
| Voice fails | Manifest without audio; captions carry the video. |
| Server unreachable | Badge says "Server not running" with a retry (§12.6). |

### 6.7 MP4 on demand [should]

`POST /api/videos/:id/render` runs the same composition through Remotion's renderer with the cached manifest and mirrored media. One render at a time, queued. The file lives until the video's TTL expires.

### 6.8 Security and privacy

- All keys live in the server's `.env`, are validated at startup, and never ship in the extension.
- Server input is validated with zod and size-capped; per-IP rate limiting; CORS limited to the extension's origin.
- Server-side image fetching and rendering only touch allowlisted hosts over HTTPS (no SSRF via client-supplied photo URLs).
- Stored data: listing id, interests, trip dates. No account, no personal data.
- Scraped photos are fine for a personal preview and a demo. Context.dev's image classification does not establish usage rights; this needs a real answer before any public launch.

## 7. How it reacts to change (real-timeness)

1. Every video is built from data at most 6 h old, and says so: an "as of" time in the outro.
2. **Trip-date aware** [decided]: events, weather and prices are for the dates in the listing URL. Different dates, different video. No dates in the URL → the coming 14 days. [call]
3. **Open-now status** on activity scenes, computed in the player at play time from the place's stored opening hours and timezone, so it is right on a cached play too. Left out when hours are missing.
4. **Price-change chips** [should]: "↓ €6 since yesterday", from `price_history`.
5. **Stretch:** Context.dev Monitors with a webhook on the experience pages of listings the user has viewed; the badge says "prices changed — refresh".

## 8. Tiers — build order

No cut line has been drawn: everything below is in scope, built in this order, so that whatever exists at any moment is a working demo.

**Must (a complete demo)**
Airbnb and Booking adapters · badge with live progress · interest picker · gather from places + experiences · trip-date awareness with events and weather · selection and accuracy guard · script · voice · live playback overlay · 6 h caches (scrapes and videos) · "as of" stamps · failure fallbacks.

**Should**
Street View scenes (once the key exists) · area guide · MP4 on demand · price-change chips.

**Stretch**
Monitors and webhooks · news item · background music · short social clips as scene media · more sites.

## 9. First three spikes (before the real build)

1. **Sources.** A script that runs each candidate source for three different kinds of place (a major tourist city, a beach town, a rural or nature area) and records latency, credits, and data quality. Output: a keep/kill table and the working URL templates and params. This is the "which sites, which query params" question.
2. **Listing extraction.** Read `ListingContext` on live Airbnb and Booking pages: coordinates, photos, dates, across SPA navigation.
3. **Player in page.** Remotion Player in an extension iframe on a real Airbnb listing, with audio and full-view overlay.

## 10. Testing

- Unit: cache keys and TTL, site adapters against saved page fixtures, place ranking, storyboard validator, scene timing from voice timestamps.
- Integration: the pipeline against recorded Context.dev responses (a fixture mode, which also saves credits during development).
- End to end: Playwright with the extension loaded on a saved listing page, through to a playing video.

## 11. Left to the builder

Exact selectors and page fields · visual design and animation (after mocks) · voice id and model names · query phrasing per interest · polling interval · deadline tuning · SQLite schema details.

## 12. Answered by the team (2026-11-14)

1. Google Maps key for Street View: in progress. Build key-optional; scene 2 uses listing photos until it lands.
2. Trip-date awareness: in.
3. End card: out.
4. Cut line: none drawn. §8 is a build order, not a scope cut.
5. Cache: 6 h for everything — scrape results and videos alike (replaces the earlier 2 h scrape TTL).
6. **Server down is shown, not hidden** (after the first hands-on test). The badge says "Server not running" with a retry.
7. **The video follows the time of year of the stay** (requested after trying Innsbruck in January and getting green parks):
   - **Usual weather.** For the stay's dates the server reads the same dates in the last three years from Open-Meteo's archive: usual low and high, and how often it rains or snows. This works for a stay months away, where no forecast reaches. It is a fact like any other: shown under the opening title ("15–20 Jan · usually −6 to 3 °C, snowy") and spoken in the opening line ("Innsbruck in January is usually…").
   - **Season.** How the stay feels is derived from that usual weather, not from the calendar: snowy, cold, mild, warm or hot. When the usual weather cannot be fetched, nothing is assumed (January is beach weather in Tenerife).
   - **Places.** Each interest's Maps search is swapped for one that suits the season where it matters — nature in snow becomes "winter activities", adventure "ski resort", water "thermal bath", food "cosy restaurant"; in heat, food becomes "restaurant with terrace"; shopping before Christmas becomes "Christmas market". If the seasonal search finds nothing within 25 km, the usual search runs instead.
   - **Experiences.** GetYourGuide is asked for the stay's dates (Viator ignores dates). An offer whose title suits the season (ski, snowshoe, sleigh… / boat, kayak…) is picked first.
   - **Pictures.** The opening scene shows a photo of the place in that season from Wikimedia Commons, used only when its title names the place, and credited in the outro. Where no offer has a photo of its own, the experiences scene shows a second such photo instead of the listing's interior.
   - **Place photos in season** (asked for after the first seasonal videos still showed green parks: "can we scrape Google Images with the keyword and winter?"). For each outdoor place, in any season that is not mild, the server runs an image search for the place, its city and the season, and shows the result in place of Google's cover photo. Google Images blocks automated requests with a CAPTCHA, so the search goes to Bing Images through Context.dev. A result is used only when it names the place or its city and does not come from a watermarked stock site or a social network. The original is downloaded when it is on a public https host (every address the host resolves to must be public; redirects are not followed); otherwise Bing's own copy is used; otherwise the cover photo stays. The search runs alongside the script and voice and is given 9 seconds.
   - **Voiceover.** The model is told the month, may open with the usual weather, and may let the other lines' wording suit the month — without adding any fact.
