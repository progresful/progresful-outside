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
cp .env.example .env   # then fill in the keys; never commit .env
```

Keys: `CONTEXT_DEV_API_KEY`, `OPENAI_API_KEY` + `OPENAI_MODEL`, `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`.
`.env.example` says where each one comes from. The server refuses to start and names any key that is missing.

## Run

```bash
pnpm dev:server          # http://127.0.0.1:8787, local only
pnpm build:extension     # writes apps/extension/.output/chrome-mv3
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → pick
`apps/extension/.output/chrome-mv3`. For live reload while developing, use `pnpm dev:extension`.

Then open a full listing page on Airbnb or Booking.com. A pill appears on the photo gallery, shows
what it is fetching, and turns into **What's outside** when the video is ready.

### See the player without the server

Open `chrome-extension://<extension id>/player.html?sample=1` (the id is on the extension's card in
`chrome://extensions`). It plays a bundled sample video: silent, no photos, real layout and timing.

## Test

```bash
pnpm test        # all packages
pnpm typecheck
```

## What works today, and what does not

Built and covered by tests: the server pipeline (places, weather, selection, script with the
fact-only guard, voice timing, manifest, cache, routes), the video composition, and the extension
(listing detection, badge, player overlay, popup, settings).

Not done yet:

- **Experiences and events** are not wired in. Videos have a hook, three places, a weather line when
  the stay is within the forecast range, and an outro. The source adapters wait on a spike that
  needs the Context.dev key.
- **Nothing has been run against the real services or real listing pages.** The listing adapters read
  standard page metadata and are tested on synthetic pages; they need checking on live pages.
- Opening hours ("Open now") are not parsed yet.
- End-to-end test.

## Demo checklist

1. Pick the listings ahead of time: one Airbnb, one Booking.com, with dates in the URL.
2. Open each within 6 hours before the demo. Videos and web data are cached for 6 hours, so replays are instant.
3. Keep one listing unopened to show live generation.
4. Check everything once on the venue network.
