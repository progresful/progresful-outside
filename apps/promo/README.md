# The promotional film

A one-minute film about Outside, made with [Remotion](https://www.remotion.dev): 1920 × 1080, 30 frames a second.
It opens on the extension at work on a real Airbnb listing, plays a real video in the full view, then shows
what the dates and the interests change, where the facts come from, and where to get it.

```bash
pnpm --filter @outside/promo render       # → apps/promo/out/outside-promo.mp4 (about three minutes)
pnpm --filter @outside/promo studio       # scrub through it in the browser
pnpm --filter @outside/promo voiceover    # voice the narrator's lines with ElevenLabs (needs credits)
pnpm --filter @outside/promo capture      # retake the opening screenshots (needs `pnpm bundle` first)
pnpm --filter @outside/promo test
```

Rendering uses whichever Chromium Remotion finds; pass `--browser-executable <path>` after the command to
name one.

## What is real in it

- **The listing** is a screenshot of a real Airbnb page, taken by `scripts/capture.mjs` with the release
  extension loaded and talking to the hosted server. Only the top of the page is shown: everything above the
  host's name and photo.
- **The badge** is the extension's own component (`apps/extension/src/badge/Badge.tsx`), drawn where it
  sat on that page. What it says while it works are the server's own stage names for that listing; the film
  shows them faster than the ten seconds the build took.
- **The video in the full view** is the product's own composition (`@outside/video`) playing a manifest
  the server built for a stay in Innsbruck on 10–13 January, with its own narrator. Its photos are the freely
  licensed ones from Wikimedia Commons that the landing page uses, in place of those the server found live.
- **The two stays, the facts and the sources** in the later scenes are from videos built on 14 November 2026.

## The voice-over

The narrator's lines are in `src/content/script.json`. `pnpm --filter @outside/promo voiceover` sends each to
ElevenLabs (voice "Lily", model `eleven_multilingual_v2`), saves one mp3 per line in `public/vo` and their
lengths in `src/content/vo.json`. A line whose text has not changed is not voiced again, and what has been
voiced is saved line by line.

The film is timed from the narration: a scene lasts as long as what is said in it. A line that has no
recording yet is timed by its length and shown as a caption. **The narrator is heard only once every line
has a recording**; until then the film is captions throughout, with the product's own voice in the middle.
So after topping up ElevenLabs: run `voiceover`, then `render`, and the same film comes out with her voice.

Captions stay on in either case.

## Changing it

- Words: `src/content/script.json`, then `voiceover` and `render`.
- When things happen: `src/timeline.ts` (tested in `test/timeline.test.ts`).
- A scene's look: `src/scenes/`. Colours and typefaces come from the extension's own tokens.
