# Outside

A Chrome extension that shows what is around an Airbnb or Booking.com listing: a 10–30 second
narrated video about the area, built from live web data and tuned to your interests and trip dates.

- Design: `docs/superpowers/specs/2026-11-14-listing-promo-video-design.md`
- Plan: `docs/superpowers/plans/2026-11-14-outside-must-tier.md`

## Layout

| Path | What |
|---|---|
| `apps/extension` | MV3 extension (WXT + React): content script, badge, player page, popup |
| `apps/server` | Fastify server: gathers facts, writes and voices the script, serves the manifest, the landing page and the download |
| `apps/site` | The landing page (`public/`: plain HTML, CSS and JavaScript, no build step) with the install guide |
| `scripts/bundle.mjs` | Builds the release extension for the hosted server and zips it for the landing page |
| `packages/video` | Remotion composition played by the extension |
| `packages/shared` | Schemas and types shared by all of the above |

## Setup

Needs Node 22.9 or newer (the scripts use `--env-file-if-exists`) and pnpm.

```bash
pnpm install
cp .env.example .env   # then fill in the three keys; never commit .env
```

Three keys are required: `CONTEXT_DEV_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`. `.env.example` says where
each one comes from. The server refuses to start and names any key that is missing. The model
(`gpt-6-sol`, reasoning off) and the voice (ElevenLabs "George") have defaults; override them in `.env` if you like.

## Run

```bash
pnpm dev:server          # http://127.0.0.1:8787, local only; restarts on code changes
pnpm build:extension     # writes apps/extension/dist/chrome-mv3
```

Load the extension in Chrome:

1. Open `chrome://extensions`.
2. Switch on **Developer mode** (top right).
3. **Load unpacked** → choose `apps/extension/dist/chrome-mv3`.
4. Pin "Outside" from the puzzle-piece menu so its popup is one click away.

After a rebuild, press the reload arrow on the extension's card, then reload the listing tab.
For live reload while developing, use `pnpm dev:extension` instead (it opens its own browser).

Then open a full listing page on Airbnb (`/rooms/<id>`) or Booking.com (`/hotel/<cc>/<name>.html`). A pill
appears on the photo gallery, shows what it is fetching, and turns into **What's outside** when the video is
ready. Click it to play; Escape, the close button or the end of the video brings the page back. Pick interests
in the popup and the video is rebuilt for them.

### See the player without the server

Open `chrome-extension://<extension id>/player.html?sample=1` (the id is on the extension's card in
`chrome://extensions`). It plays a bundled sample video: silent, no photos, real layout and timing.

## Test

```bash
pnpm test             # all packages
pnpm typecheck
pnpm test:coverage    # shared 83 %, video 74 %, server 96 %, extension 84 % of statements
pnpm check:live       # the real thing: see below
pnpm check:site       # the landing page in a real browser, desktop and phone
```

`pnpm check:live [airbnb|booking|<listing url>]` loads the built extension in Chromium, opens a real listing,
waits for the badge, plays the video and closes it again. It needs the server running and the extension built,
and it spends real credits. Screenshots land in `e2e/out/`. Set `HEADED=1` to watch, and `CHROMIUM=<binary>` to
use a Chromium other than the one Playwright downloads (`pnpm exec playwright install chromium`).

## The landing page and the release

`apps/site/public` is the page people install from: what Outside does, an example video, and the six steps
to load an extension in Chrome with Developer mode. The server serves it at `/` whenever that folder has
an `index.html` (set `SITE_DIR` to serve another folder), next to the API.

```bash
pnpm bundle           # release build + apps/site/public/download/outside-extension.zip
pnpm check:site       # needs the server running; screenshots land in e2e/out/
```

`pnpm bundle` builds the extension with `https://outside.pgf.lv` as its server (override with
`OUTSIDE_SERVER_URL=https://…`), checks that the address really reached the build, and zips it with one
top-level folder, `outside-extension`, which is what people point "Load unpacked" at. It also writes
`release.json` (version, size, checksum), from which the page shows the version and file size. The release
goes to `apps/extension/dist-release`; the development build in `apps/extension/dist` is left alone and
keeps talking to `http://localhost:8787`. Neither the zip nor `release.json` is committed: run `pnpm bundle`
wherever the page is served from.

The example video on the page is a real one: the manifest and the voice track of a video the server built
on 14 November 2026 for a stay in Innsbruck, 10–13 January. Only the photos differ. The ones the extension
finds live belong to whoever published them, so the page shows freely licensed photos from Wikimedia
Commons instead, credited in its footer. `apps/site/test` checks that the page asks for no file it does not
have, loads nothing from another site, and carries no inline style or script: the server sends a
Content-Security-Policy that would silently drop those.

### Hosting it

The same server runs on a host with a reverse proxy (Caddy, nginx) in front for HTTPS:

```bash
pnpm install && pnpm bundle
HOST=127.0.0.1 PORT=8787 TRUST_PROXY=1 pnpm start      # with the three keys in .env
```

- `TRUST_PROXY` is the number of reverse proxies in front: `1` for a single Caddy or nginx. The visitor's
  address is then the one that proxy saw (the last entry of `X-Forwarded-For`), so every visitor has an
  allowance of their own and cannot get a fresh one by writing an address into the header. At `0`, the
  default, the header is ignored. Never set it higher than the number of proxies you run.
- `HOST` stays `127.0.0.1` when the proxy runs on the same machine; use `0.0.0.0` only inside a container,
  and do not publish that port past the proxy.
- The server holds paid keys, and anyone who installs the extension can ask it for videos. So new videos
  are limited: `VIDEO_BUILDS_PER_VISITOR_PER_HOUR` (default 120), `VIDEO_BUILDS_AT_ONCE` (4) and
  `VIDEO_BUILDS_PER_DAY` (1500, everyone together). A video that is already made is never counted. Over
  the at-once limit the badge waits and asks again; over the hour or the day it says the video could not
  be built, with Retry. People behind one shared address (an office, a venue) share one hourly allowance.
- Have the proxy add `Strict-Transport-Security`. The server itself sends `X-Content-Type-Options` on
  everything and a Content-Security-Policy with the page.
- Copy the site folder as real files; the server follows symbolic links inside it.

## What a video is made of

| Scene | Live source | Notes |
|---|---|---|
| Opening | Open-Meteo archive, Wikimedia Commons | the month and what the weather is usually like then ("15–20 Jan · usually −6 to 3 °C, snowy"), over a photo of the place in that season |
| Three places, one per interest | Google Maps via Context.dev | searched to suit the season; rating, walking or driving time, photo, "Open now" worked out when the video plays |
| Experiences with prices | Viator and GetYourGuide results pages via Context.dev | best-reviewed offer for the season and per interest; per-person prices only; GetYourGuide is asked for the stay's dates |
| During your stay | Songkick via Context.dev, else Open-Meteo forecast | a concert inside the trip dates, otherwise the forecast when the stay is within 15 days |
| Voiceover | OpenAI writes one line per scene, ElevenLabs speaks it | a guard rejects any number that is not in that scene's facts |

Everything fetched is kept for 6 hours, so a second visit is instant; the video says when its oldest fact
was fetched. How the sources were chosen, and what was tried and dropped (Airbnb Experiences, Tripadvisor,
Eventbrite), is in `docs/spikes/2026-11-14-sources.md`.

### It follows the time of year

The stay's dates decide what the video shows. The server reads the same dates in the last three years from
Open-Meteo's archive, so it knows what January in Innsbruck is usually like even though no forecast reaches
that far. From that it works out how the stay will feel (snowy, cold, mild, warm, hot) and:

- searches Maps for what suits it: "winter activities", "ski resort", "thermal bath" and "cosy restaurant" in
  snow; "restaurant with terrace" and "rooftop bar" in heat; "Christmas market" in the weeks before Christmas.
  If a seasonal search finds nothing within 25 km, the usual search runs instead;
- prefers a bookable offer that suits it (snowshoe, sleigh, husky… or boat, kayak…);
- opens on a photo of the place in that season, when Wikimedia Commons has one whose title names the place;
- swaps each outdoor place's stock photo for one taken in that season, found by image search
  ("Innsbrucker Hofgarten Innsbruck winter snow"). The search runs while the script is written and voiced.
  The original photo is used when it sits on a public https host; otherwise the search engine's own copy;
  and if neither downloads, or the search takes more than 9 seconds, the stock photo stays;
- lets the voiceover open with the month and the usual weather.

Image search goes to Bing Images through Context.dev. Google Images answers automated requests with a
CAPTCHA page, which this project does not work around. Watermarked stock-photo sites and social networks are
skipped, and a photo is used only when its title or address names the place or its city. The outro credits
"Bing Images". These photos belong to whoever published them: fine for a demo, not cleared for a public product.

When the usual weather cannot be fetched (it is tried twice), a winter stay beyond 40° of latitude is still
treated as cold; otherwise nothing is assumed and the video is built the plain way. In a mild season no image
search is made, and restaurants, bars, museums and spas always keep their stock photo.

### Things to do, not only places to see

Four interests are about doing something: Adventure & sports, Nature & hikes, Beaches & water, Family & kids.
For those the server does not search Maps for "outdoor activities"; it searches for where each activity of
the season is done, and labels the scene with it:

| Season of the stay | Adventure & sports | Nature & hikes | Beaches & water | Family & kids |
|---|---|---|---|---|
| Snowy or cold | Ski & snowboard, sledding, ice skating | Snowshoe & winter walks, cross-country skiing | Thermal baths, indoor pools | Sledding, ice skating |
| Warm or hot | Quad & buggy, swimming, rafting & canyoning, mountain biking, climbing, paragliding | Hiking, viewpoints | Swimming, kayak & SUP, boat trips | Swimming, adventure parks |
| Mild | Mountain biking, climbing, quad & buggy | Hiking, viewpoints | Kayak & SUP, boat trips | Adventure parks |

A video makes at most four place searches, shared between the picked interests in turn, most wanted activity
first. One interest alone gets four activities searched and the best three shown.

Each activity scene shows, all from live data:

- the activity ("Ski & snowboard") and the place Maps lists first or second for it ("Stubai Glacier");
- what kind of place it is, its rating and number of reviews, and the drive: "Ski resort · 4.7 rating ·
  11,817 reviews · ≈ 45 min drive". People drive to a ski area, so an activity may be up to 40 km away;
- Maps' own one-line description of the place;
- the best offer on Viator or GetYourGuide whose title names the activity, with its price: "A guided
  Ski-Day in Innsbruck … from €340". That offer is then not repeated in the experiences scene.

What keeps it honest: only Maps' first two results for an activity are trusted; a place for the other half
of the year ("Sommerrodelbahn" in January) is dropped; a place whose name is that of another activity is
dropped (a search for rafting in Albufeira returns kayak tours); and a rafting base, quad outfit, kayak
rental, climbing or bike park, paragliding school, boat tour, adventure park or ice rink must say what it is
in its name, kind or description. A place that says nothing either way ("Rumer Alm", a mountain hut with a
toboggan run) is taken on Maps' word only when it is the first result. Where an activity is not found
nearby, there is no scene for it. An offer goes with the activity its title names most exactly, so a
"cross-country skiing day" is not shown beside a downhill ski area. The offer is for the activity in the
area, not necessarily at that very place; its title says where. The drive is an estimate from the
straight-line distance (30 km/h in town, 60 beyond, 80 on a long run), rounded to five minutes above twenty.

## Limits worth knowing

- **Context.dev allows a free organisation 10 requests a minute.** A new video in a new city uses up to 7 (four
  place searches, two marketplaces, events), a few more when the planned searches found too little and each
  interest's broad search runs as well, and one more for each outdoor place
  whose photo is searched. Past ten, the photo searches are the ones that wait, and after 9 seconds the
  stock photos are used. The server queues beyond that rather than fail, so a second new city inside the same minute
  gets a thinner video or "Not enough live data"; a retry a minute later works. On a bigger plan, set
  `CONTEXT_DEV_RPM` in `.env`.
- Typical times, measured on real listings: 11–13 s for a new city, 4–8 s when the city is cached, instant when
  the video itself is cached.
- Experiences and events are looked up by city name as the listing gives it. A listing in a village may get
  places only.
- Booking.com drops the dates from the address for some visitors; the video then covers the next two weeks.
- The Viator, GetYourGuide and Songkick parsers read each site's results page as it is today. If a site
  changes its page, that scene should disappear from new videos until the parser is updated: a card the parser
  cannot read with confidence (no clear title, an ambiguous price) is dropped rather than shown.
- Street View scenes, MP4 export and the other later-tier ideas in the design are not built.

## Demo checklist

1. Start the server, load the extension, and pick the listings ahead of time: one Airbnb, one Booking.com,
   with dates in the address.
2. Open each within 6 hours before the demo, one at a time, a minute apart. Replays are then instant.
3. Keep one listing in an already-opened city unopened, to show a live build in a few seconds.
4. Check everything once on the venue network.
