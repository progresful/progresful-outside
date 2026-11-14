# Developing Outside

How to run it on your own machine, test it, and make the release. For putting it on a server see
[hosting.md](hosting.md); for what a video contains and why, [how-it-works.md](how-it-works.md).

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

## The promotional film

`apps/promo` renders the one-minute film and its ElevenLabs voice-over; see [its README](../apps/promo/README.md).
`deploy/film.sh` puts the rendered film on the server.

## Demo checklist

1. Start the server, load the extension, and pick the listings ahead of time: one Airbnb, one Booking.com,
   with dates in the address.
2. Open each within 6 hours before the demo, one at a time, a minute apart. Replays are then instant.
3. Keep one listing in an already-opened city unopened, to show a live build in a few seconds.
4. Check everything once on the venue network.
