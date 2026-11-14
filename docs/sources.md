# Source spike — which sources work through Context.dev

Run on 2026-11-14 against Lisbon and Porto, with throwaway scripts that have since been removed from the
repository (they are in its history under `spikes/`). Recorded responses used by tests are in
`apps/server/test/fixtures/contextdev/`. Credits spent: about 80 of the 600-credit cap.

## The finding that shapes everything: 10 requests per minute

The account is a free Context.dev organisation. Its limit is **10 requests per minute across the organisation**,
whatever the credit balance. The 11th request in a minute gets:

```json
{ "message": "API rate limit exceeded: 10 request units are allowed per minute and this request uses 1. Retry in 35 seconds.", "error_code": "RATE_LIMITED" }
```

Consequences, all implemented:

- A cold video spends 6 requests with the default three interests (3 places + 2 marketplaces + 1 events page),
  8 with five interests, one more when the listing has no coordinates.
- Experiences and events are cached **per city**, not per interest set, so changing interests costs places requests only.
- The client holds requests beyond the allowance (`CONTEXT_DEV_RPM`, default 10) instead of burning a 429.
  A second cold video for another city inside the same minute still gets its places first; the rest may miss the
  12-second source deadline and be left out of that video, but they finish in the background and fill the cache.
- Search-then-scrape (1 + 3 requests per source) was dropped for one results page per source.

Raising the plan's limit removes all of this: set `CONTEXT_DEV_RPM` to the new figure.

## Keep / kill

| Source | Call | Latency | Credits | Usable | Verdict |
|---|---|---|---|---|---|
| Google Maps places | `scrape`, `parse` + prebuilt `google-maps` | 4.9 s | 1 | 20 places with rating, reviews, coordinates, photo, hours | **keep** |
| Viator results page | `scrape`, `markdown` + images | 6.8–8.8 s | 1 | 24 tours: title, from-price, duration, rating, reviews, photo | **keep** |
| GetYourGuide results page | `scrape`, `markdown` + images | 4.8 s | 1 | 24 activities: title, price, duration, rating, reviews (photos are lazy-load placeholders) | **keep** |
| Songkick upcoming events | `scrape`, `markdown` | 3.6 s | 1 | 10 concerts/festivals with full dates and venues | **keep** |
| Viator / GetYourGuide, `json` extraction | `scrape`, `json` + schema | 15–18 s (Viator timed out at 30 s once) | 5 | same data | kill: three times slower, five times dearer, over the 12 s deadline |
| Airbnb Experiences | `scrape`, `json` and `markdown` | 5–17 s | 1–5 | 20–30 titles with ratings and photos, **no prices** to a logged-out visitor | kill for now: the scene needs prices |
| Tripadvisor search | `scrape`, `json` | 18.7 s | 5 | 0 items | kill: blocked. Its bookable tours are Viator's inventory (Viator is Tripadvisor's marketplace; photos come from `tacdn.com`), so Viator covers it |
| Eventbrite city page | `scrape`, `json` / `markdown` | 14.9 s / 18.9 s | 5 / 1 | 28 events, relative dates ("Today", "Sat, Nov 28"), a few prices | kill for now: over the deadline; worth a second look with a longer one |
| Klook, Tiqets, Time Out | `scrape`, `json` | 1.5–7 s | 1–5 | 0 items | kill |
| `/web/search` for events | `search`, `freshness: last_month` | 2.9 s | 1 | news articles, not listings | kill |
| `/web/search` for experiences | `search`, `includeDomains` | 2.3 s | 1 | good links, but each needs its own scrape | kill under the 10/min limit |

Civitatis was never reached (rate limited in the first batch) and not retried.

## Working requests

Places:

```json
{ "url": "https://www.google.com/maps/search/<query near location>", "formats": { "parse": true },
  "parseParams": { "type": "prebuilt", "parser": "google-maps" } }
```

Marketplace and events pages:

```json
{ "url": "<results page>", "formats": { "markdown": true }, "markdownParams": { "includeImages": true },
  "sharedParams": { "country": "DE" } }
```

- Viator: `https://www.viator.com/searchResults/all?text=<city>` (redirects to the city's things-to-do page)
- GetYourGuide: `https://www.getyourguide.com/s/?q=<city>`
- Songkick: `https://www.songkick.com/search?query=<city>&type=upcoming`

`sharedParams.country` decides the currency the marketplaces quote: `DE` gives euros, `US` dollars, `GB` pounds.
Without it the fetch is from the US and prices come back in dollars.

## Shapes worth knowing

- **Scrape response:** every output is `{ requested, success, data }`; `markdown.data` is a string. Also
  `cache_metadata: { status, age_ms }` and `key_metadata: { credits_consumed, credits_remaining }`.
- **Search response:** `{ results: [{ url, title, description, relevance, markdown, highlights }], query, … }`.
- **`google_hours`:** `[{ "day": "Saturday", "times": ["10 AM–12 AM"] }, …]`, one entry per weekday, any order.
  Times seen: `10 AM–12 AM`, `12–4:30 PM` (opening time inherits AM/PM), `11 AM–2 AM` (past midnight), `Closed`.
  `open_status` was null on every record, so "Open now" is computed from the hours when the video plays.
- **Cards in markdown:** a result card is one link whose text holds the card's lines, separated by doubled
  backslashes. Viator: photo, blurb, title, duration, rating, `(reviews)`, `from **€70**` — or `from`, old price,
  current price when discounted. The photo's alt text is often a caption, not the title. GetYourGuide glues the
  place prefix and the duration onto the title (`LisbonSintra, Pena…9 hours • Skip the line`).
- **Group prices:** GetYourGuide marks them `per group up to 4` or `Private group`; those offers are dropped.
  Viator's `Price varies by group size` keeps a per-person from-price and stays.
- **Image hosts:** `lh3.googleusercontent.com` (Maps), `dynamic-media.tacdn.com` and `media.tacdn.com` (Viator),
  `a0.muscache.com` (Airbnb), `images.sk-static.com` (Songkick), `cdn.getyourguide.com` (placeholders only).

## Model and voice

Benchmarked on the real script prompt, two to four runs each, checked by the accuracy guard:

| Model | Reasoning | Time | Valid scripts | Notes |
|---|---|---|---|---|
| `gpt-6-sol` | none | 1.8–1.9 s | 4 / 4 | best lines ("Step outside and let Lisbon draw you in.") — **chosen** |
| `gpt-5.4-mini` | none | 1.1–1.4 s | 4 / 4 | fastest; flatter copy |
| `gpt-6.1-terra` | none | 2.1–2.6 s | 4 / 4 | fine, slower |
| `gpt-5.5` | none | 2.3–2.6 s | 4 / 4 | fine, slower |
| `gpt-6-luna` | none | 1.6–1.8 s | 2 / 4 | ran over the word budget |
| `gpt-6-astra`, `gpt-6-luna`, `gpt-5.6-luna` | default | 5–11 s | mixed | reasoning makes them too slow here |

Before the prompt gave a per-line word limit, every model overshot the total budget; with it, the top four
never did. Voice: ElevenLabs "George" (`JBFqnCBsd6RMkjVDRZzb`), a stock warm British storyteller, on
`eleven_flash_v2_5` at speed 1.1.

## First real run

Lisbon listing, stay 20–24 November, interests food / museums / nature, everything cold:
**13.4 s** to a playable 27-second video (places 7.8 s, script 2.0 s, voice 2.8 s), 6 Context.dev requests,
6 credits.

## Added the same day: making the video follow the time of year

Asked for after a January trip to Innsbruck produced green parks. Checked before building:

| Question | Call | Answer |
|---|---|---|
| What is the weather usually like on dates months away? | `archive-api.open-meteo.com/v1/archive` with the same dates in past years, `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum` | Free, no key, well under a second. Three past years are averaged. No scraping needed. |
| Does Maps answer seasonal searches? | `ski resort near Innsbruck, Austria`, `winter activities near …` through the google-maps parser | Yes: Stubai Glacier, Nordkette, Seegrube, Bergisel — against Rapoldipark and Hofgarten for the usual `park`. |
| Do the marketplaces take the stay's dates? | GetYourGuide `&date_from=…&date_to=…`; Viator `&startDate=…&endDate=…` | GetYourGuide keeps the dates and changes its results. Viator redirects to the city page and drops them. |
| Is there a photo of the place in season? | Wikimedia Commons search API, `Innsbruck winter snow filetype:bitmap` | The first three results are winter views of Innsbruck. Results below them are unrelated ("Green tent on a snow covered mountain"), so a photo is used only when its title names the place. |

Wikimedia asks clients to identify themselves; the server sends a generic `OutsideVideo/0.1` user agent with no
personal details. Images come from `upload.wikimedia.org`, now on the mirror's host allowlist.

### Activities by season (same day, later)

Maps answers an activity search well when the activity exists nearby, and with the nearest related business
when it does not. Measured on real runs:

| Search | Where and when | First results | What it taught |
|---|---|---|---|
| "ski resort" | Innsbruck, January | Stubai Glacier, Innsbruck - Nordkette, Rosshütte, …, Bergisel Ski Jump (5th) | Trust the first two; further down it drifts to anything with "ski" in it. |
| "cross-country ski trail" | Innsbruck, January | Torfstich Loipe (17 reviews), then every well-known ski lift | Niche activities have few reviews: the floor is 10, not 50. |
| "toboggan run" | Innsbruck, January | Rumer Alm, Sommerrodelbahn (Alpine Slide), Olympia Eiskanal | Drop places named for the other half of the year. |
| "quad ATV buggy tour" | Innsbruck, July | Two outfits 100–160 km away | Nothing within 40 km means no scene, rather than a far or wrong one. |
| "rafting" | Albufeira, July | Kayak Caves Tours, Dream Wave (boat tours) | There is no rafting there. Operator-run activities must be named by the place itself. |
| "kayak rental" | Innsbruck, July | "SOURCE TO SEA - Kayak School - Shop - Rafting" (kind: Store) | Names padded with keywords broke the script's word limit; kinds like "Store" say nothing. |

Marketplace offers for a niche activity often have no rating at all (a €160 snowshoe hike, a €340 guided ski
day with two reviews), so the offer shown beside an activity is held to a lower bar than the experiences scene.

### Photos of each place in season

| Question | Call | Answer |
|---|---|---|
| Can Google Images be scraped? | `scrape` of `google.com/search?tbm=isch&q=…` and of `…&udm=2` | No. The first is redirected to Google's CAPTCHA page (`/sorry/`), the second returns a redirect shell with no results. Not pursued. |
| Can Bing Images? | `scrape`, `html`, of `bing.com/images/search?q=…&qft=+filterui:imagesize-large+filterui:aspect-wide+filterui:photo-photo` | Yes: 6.6 s, 1 credit, about 35 results. Each result is an `a.iusc` whose `m` attribute is JSON with `t` (title), `murl` (the original), `turl` (Bing's copy), `purl` (the page). |
| How good is Bing's own copy? | `turl` plus `&w=1280&h=720&c=7&rs=1` | It comes back at the size asked for, but enlarged from a 474-pixel thumbnail, so it is soft. The original is preferred. |

Stock-photo sites come up near the top with watermarked images (the fourth result for "Innsbrucker Hofgarten
winter" was Alamy), so those hosts are skipped. For Innsbruck on 10–13 January the search turned the Golden
Roof, the Nordkette cable car and the old town into snow-covered views, each from an original of 1100 pixels
or wider.
