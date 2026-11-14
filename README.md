# Outside

A Chrome extension that shows what is around an Airbnb or Booking.com listing: a 10–30 second
narrated video about the area, built from live web data and tuned to your interests and trip dates.

- Design: `docs/superpowers/specs/2026-11-14-listing-promo-video-design.md`
- Plan: `docs/superpowers/plans/2026-11-14-outside-must-tier.md`

## Layout

| Path | What |
|---|---|
| `apps/extension` | MV3 extension (WXT + React): content script, badge, player page, popup |
| `apps/server` | Local Fastify server: gathers facts, writes and voices the script, serves the manifest |
| `packages/video` | Remotion composition played by the extension |
| `packages/shared` | Schemas and types shared by all of the above |

## Setup

Needs Node 20+ and pnpm.

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
pnpm test             # all packages (534 tests)
pnpm typecheck
pnpm test:coverage    # shared 83 %, video 74 %, server 96 %, extension 84 % of statements
pnpm check:live       # the real thing: see below
```

`pnpm check:live [airbnb|booking|<listing url>]` loads the built extension in Chromium, opens a real listing,
waits for the badge, plays the video and closes it again. It needs the server running and the extension built,
and it spends real credits. Screenshots land in `e2e/out/`. Set `HEADED=1` to watch, and `CHROMIUM=<binary>` to
use a Chromium other than the one Playwright downloads (`pnpm exec playwright install chromium`).

## What a video is made of

| Scene | Live source | Notes |
|---|---|---|
| Three places, one per interest | Google Maps via Context.dev | rating, walking or driving time, photo, "Open now" worked out when the video plays |
| Experiences with prices | Viator and GetYourGuide results pages via Context.dev | best-reviewed offer per interest; per-person prices only |
| During your stay | Songkick via Context.dev, else Open-Meteo | a concert inside the trip dates, otherwise the weather outlook |
| Voiceover | OpenAI writes one line per scene, ElevenLabs speaks it | a guard rejects any number that is not in that scene's facts |

Everything fetched is kept for 6 hours, so a second visit is instant; the video says when its oldest fact
was fetched. How the sources were chosen, and what was tried and dropped (Airbnb Experiences, Tripadvisor,
Eventbrite), is in `docs/spikes/2026-11-14-sources.md`.

## Limits worth knowing

- **Context.dev allows a free organisation 10 requests a minute.** A new video in a new city uses 6 (8 with five
  interests). The server queues beyond that rather than fail, so a second new city inside the same minute
  gets a thinner video or "Not enough live data"; a retry a minute later works. On a bigger plan, set
  `CONTEXT_DEV_RPM` in `.env`.
- Typical times, measured on real listings: 11–13 s for a new city, 4–8 s when the city is cached, instant when
  the video itself is cached.
- Experiences and events are looked up by city name as the listing gives it. A listing in a village may get
  places only.
- Booking.com drops the dates from the address for some visitors; the video then covers the next two weeks.
- The Viator, GetYourGuide and Songkick parsers read each site's results page as it is today. If a site
  changes its page, that scene disappears from new videos until the parser is updated; nothing wrong is shown.
- Street View scenes, MP4 export and the other later-tier ideas in the design are not built.

## Demo checklist

1. Start the server, load the extension, and pick the listings ahead of time: one Airbnb, one Booking.com,
   with dates in the address.
2. Open each within 6 hours before the demo, one at a time, a minute apart. Replays are then instant.
3. Keep one listing in an already-opened city unopened, to show a live build in a few seconds.
4. Check everything once on the venue network.
