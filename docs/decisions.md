# Decisions and known gaps

Outside was built in a day, at the Junction 2026 hackathon. Along the way a great many small calls had to be
made where the design was silent, where two parts of it disagreed, or where the live web behaved differently
from what was expected. This is the record of those calls: what was decided, why, and what it costs if the
call was wrong. It is taken from the build log, in the order the calls were made.

The design itself is in [design.md](design.md); how a video is made today is in [how-it-works.md](how-it-works.md).

## The first build: extension, server and video

- **Fresh repo, so isolation is a feature branch (feat/must-tier), not a worktree; docs committed on main first so no implementation lands on main.** Plan said scaffold on main then branch. *If wrong:* None, history differs by one commit.
- **Task order.** Tasks needing no API keys or live pages run first (1,5,6,7, then pure-logic tasks); spikes 2-4 and fixture-dependent tests (8,9,10 events,17) run when keys/pages are available — user is still obtaining keys. *If wrong:* An interface may need adjusting once spike data is seen.
- **Create sources/tripWindow.ts (type + resolveTripWindow, T10's tests for it) before T9.** *If wrong:* None.
- **Add a separate ContentMessage type in src/messages.ts at T21.** *If wrong:* None.
- **ScrapeOutput.data is typed unknown (validated loose zod schema) instead of the plan's generic ScrapeOutput<T>; adds ContextDevError(status) base class.** External data must be narrowed by each adapter. *If wrong:* Adapters carry a few more lines of narrowing.
- **SourceDeps gained optional onSourceError(sourceId, error) so skipped sources are logged, not silently swallowed; haversineM/round2 live in sources/geo.ts (places.ts will re-export haversineM).** User rule "never silently swallow errors". *If wrong:* One extra optional field.
- **WriteLines takes (complete, plan, facts, place, wordBudget, problems?).** Plan omitted place and the retry reasons; scriptWithGuard has optional 4th arg onFallback(reasons) so a template fallback is reported. *If wrong:* None, additive.
- **The real Complete (pipeline/openaiComplete.ts) calls OpenAI chat completions with raw fetch, not the openai package.** One less dependency, fully unit-tested with a fake fetch. *If wrong:* Swap in the SDK behind the same Complete type.
- **ValidateLines also rejects spelled-out numbers (tens/hundreds, or 1-10 followed by a unit).** A model can invent "twenty minutes" without digits. *If wrong:* More template fallbacks.
- **A scene ends 0.25 s after its line OR when the next line starts, whichever is sooner (plan said always +0.25 s).** Otherwise the next line's first words play over the previous scene; sceneTimings also tolerates an alignment whose length differs from the text by scaling offsets. *If wrong:* Cuts land up to 0.25 s earlier than the plan's rule.
- **SceneImageUrls(listing, sel) added so the runner knows what to mirror; mirrorImage reads with a streaming 8 MB cap and takes optional onError; IMAGE_HOST_ALLOWLIST carries provisional experience hosts (getyourguide.com, tacdn.com, viator.com) to be confirmed by the Task 2 spike.** *If wrong:* An experience image fails to mirror and the scene falls back to the listing photo.
- **Sources are injected (PipelineDeps.sources: PipelineSources) rather than imported by run.ts; PipelineInput carries videoId; each source gets a 12 s pipeline-level deadline (spec §6.4).** *If wrong:* None, additive.
- **Manifests are cached under `video:<videoId>` (videoId = first 16 hex of videoKey) so GET can find them after a restart; a job is deleted once its manifest is cached; a failed job does not block a new POST.** *If wrong:* None.
- **/media is a small route (routes/media.ts) with a safe-name check instead of @fastify/static.** One less dependency. *If wrong:* No range requests for audio seeking; swap in the plugin.
- **Interest gained `stageNoun` ("museum", "beach"…) so the progress line reads "Finding museum spots" rather than the plan's lower-cased shortLabel ("Finding museums spots").** *If wrong:* Copy differs slightly from plan wording.
- **Non-user-facing failures surface as "Could not build the video"; only NotEnoughDataError's message is shown to users.** Security rule: error messages must not leak internals.
- **OutsideVideo is a plain function component with a type-alias props type, not React.FC (user's TypeScript rule; Remotion Player needs Record-compatible props); one generic scenes/SceneView.tsx instead of five near-identical scene files (DRY).** *If wrong:* Split later.
- **AsOfLabel(iso, timeZone?) takes a timezone, not a locale (deterministic tests; viewer's zone by default); captions show in fixed groups of 6 words rather than a sliding window (text holds still); sceneText() is a pure view-model so the play-time open-now and as-of logic is unit-tested.** *If wrong:* None.
- **No @remotion/cli / Remotion Studio install; the visual check of the composition moves to the extension's player page (Task 20) fed with sample-manifest.json.** Avoids a heavy dev dependency. *If wrong:* Add @remotion/cli later.
- **Settings are a factory (createSettingsStore(area), watchSettings(events, store, cb)) with src/browserSettings.ts binding them to browser.storage.sync, instead of free getSettings/saveSettings functions.** Unit-testable without a browser; stored values are repaired, never trusted. *If wrong:* None.
- **Background messages are validated with a zod discriminated union in routeMessage(api, raw); bad messages get {success:false,error:'bad message'}.** Validate at every boundary. *If wrong:* None.
- **Airbnb match patterns are an explicit TLD list in src/sites/hosts.ts (match patterns cannot wildcard a TLD); 29 Airbnb domains + booking.com.** *If wrong:* A missing country domain shows no badge; add the TLD.
- **A refresh that fails falls back to ready(old video) rather than the error state; start(listing) resets state so a new listing never inherits the previous listing's video; a missing/invalid reply from the background worker counts as unreachable.** *If wrong:* A failed interest change is silent (old video stays).
- **Built before the listing-extraction spike, on synthetic fixtures, because live pages were unreachable (no browser connection).** Hosts are matched exactly against the AIRBNB_HOSTS list / www.booking.com, not by loose regex. *If wrong:* Selectors or JSON-LD assumptions need changing once real pages are seen; the badge falls back to a fixed corner if the gallery selector misses.
- **MountBadge(doc, gallery, handlers) takes the document and a handlers object; the host is positioned in page coordinates over the gallery (absolute, repositioned on resize) so the gallery element itself is never restyled; the badge uses the system font stack (no @font-face is injected into the host page); a pageController (onUrl/onSettings/playCurrent/snapshot/stop) owns badge + session per visit and retries extraction for 10 s on SPA pages.** *If wrong:* Badge may drift if the page lays out without a resize event when ResizeObserver is unavailable.
- **The player page accepts ?sample=1 (bundled sample manifest, no server) for the visual check that Task 16 deferred; the overlay also locks page scroll while open and restores the previous value; Latin-only font files are bundled.** *If wrong:* None.
- **The card model lives in cardModel.ts, not the plan's statusCard.ts.** On a case-insensitive disk `./StatusCard` resolved to statusCard.ts and the component import came back undefined. *If wrong:* None.
- **Popup "Retry" on a failed build sends badge:retry to the page (PageController.retry).** The plan gave the error card a Retry action but no path for it; SettingsStore.save now serialises saves and writes only changed keys (two quick saves overwrote each other — found by the popup test). *If wrong:* None.
- **The account is a free Context.dev organisation limited to 10 requests/minute; the client now holds requests to that allowance (CONTEXT_DEV_RPM, default 10) and experiences/events are cached per city instead of per interest set.** *If wrong:* On a higher plan the default throttles needlessly until CONTEXT_DEV_RPM is raised.
- **Experiences come from one results page per marketplace (Viator, GetYourGuide) fetched as markdown and parsed in code, not search-then-scrape with JSON extraction as the plan said.** JSON extraction took 15–18 s (over the 12 s deadline) and 5 credits; markdown takes 5–9 s and 1 credit, and parsing in code cannot invent a price. *If wrong:* A markup change on either site empties that source until the parser is updated (the video then simply has no experiences scene).
- **Airbnb Experiences and Tripadvisor are not sources. Airbnb shows no prices to a logged-out visitor; Tripadvisor returned nothing (blocked). Viator is Tripadvisor's own booking marketplace, so its inventory is covered. The user asked for both by name.** Reported to them. *If wrong:* None hidden; adding either is a new adapter once prices are reachable.
- **Events come from Songkick (concerts and festivals, full dates, 3.6 s). Eventbrite was 15–19 s and is left out.** *If wrong:* Stays with no concert in them show the weather instead of an event.
- **OpenAI model gpt-6-sol with reasoning off, ElevenLabs voice George at speed 1.1, both as config defaults (OPENAI_MODEL and ELEVENLABS_VOICE_ID are now optional).** Chosen by benchmark, see the spike doc. *If wrong:* One env var each to change.
- **PlaceFact gained category and description (Maps' own one-line description) so the script can say what a place is from a real fact rather than invent it; Google photo URLs are rewritten to 1280x720.** *If wrong:* None.
- **Offers priced per group ("per group up to 4", "Private group") are dropped; Viator's "Price varies by group size" stays because its from-price is per person; a discounted card's current price is used, never the crossed-out one.** *If wrong:* A few offers missing.
- **Prices are fetched from a country matching the listing's currency (EUR→DE, USD→US, GBP→GB, else DE).** *If wrong:* Prices in euros for other currencies.
- **An event is kept only when its venue names the listing's country (or city when the listing gives no country).** A text search for "Lisbon" also finds Lisbon, Ohio. *If wrong:* Events dropped when the listing's country is spelled in another language.
- **Listing photos are requested at video size (Airbnb ?im_w=1440, Booking max1280x900) and Booking gallery images are added.** *If wrong:* A photo URL pattern change falls back to the original URL.
- **The end-to-end test is e2e/live.mjs, a Playwright-driven run of the built extension against real listing pages and the real server, not a hermetic spec with E2E=1 stubs as the plan said.** It is what proved the product works and it found five real bugs; a hermetic spec was not written. *If wrong:* No end-to-end test runs offline or in CI.
- **"snow" is said when the stay's high is at or below 0 °C, "rain" otherwise.** Open-Meteo gives one precipitation chance, not its kind. *If wrong:* "rain" said for a stay that hovers just above freezing and snows.
- **This adds a badge state the approved mocks did not have, reusing the error pill's layout.** *If wrong:* Copy/visuals to adjust. The popup not opening in the user's Chrome was not reproduced (works in headed and headless Chromium 156); their Chrome had an update pending.
- **The badge keeps its high z-index.** Lowering it needs a look at both live sites to be sure the badge is not hidden behind the gallery, and a hidden badge is the worse failure. *If wrong:* The pill can sit on top of a site's own photo overlay.
- **The guard still cannot tell that a performer's or place's name was swapped for another.** Names are free text. *If wrong:* A line could name the wrong act for a real date; the on-screen subtitle, built in code, stays right.
- **Three parts of Important 3 are not done: GetYourGuide is still searched by city name alone (no way found to check which destination it resolved to); a location that is only a country ("Home in Portugal") still gets country-wide tours; a listing without coordinates takes the first Maps hit unchecked.** *If wrong:* Tours from the wrong city of the same name, or a video about a guessed place, on listings that give no city or no coordinates. Both sites gave both on every page tested.
- **The rest of Important 7 stands as is: a thin or silent video is cached for the full 6 h; time queued behind the 10/min allowance counts against the 12 s source deadline; queued requests for an abandoned listing are not cancelled.** *If wrong:* A degraded video sticks for six hours, and a third new city in one minute fails as "not enough data". Raising CONTEXT_DEV_RPM removes the queueing.
- **Important 10's hermetic end-to-end spec and the Task 3/4 spike documents are not written.** *If wrong:* See Task 22 ruling.

## Following the time of year

- **Usual weather comes from Open-Meteo's archive API, not a scraped climate page as the user floated ("maybe … as a scrape").** Free, keyless, sub-second, and it costs none of the 10 Context.dev requests a minute. *If wrong:* The user wanted it to show off Context.dev; a scrape adapter can be added beside it.
- **When the usual weather cannot be fetched, the season is treated as mild and nothing seasonal is searched.** A calendar guess would send a January visitor in Tenerife to thermal baths. *If wrong:* A plain, unseasonal video on the rare archive failure.
- **Place photos stay Google's cover photos and are not checked for season; only the opening scene gets a seasonal photo (Wikimedia Commons, used only when its title names the place).** Checking every place photo would need an image model call per photo. *If wrong:* A park found in winter can still show green trees, which is the user's original complaint only partly answered.
- **"Christmas market" replaces the shopping search for stays touching 20 Nov–26 Dec everywhere, with the usual search as fallback when nothing is found within 25 km.** *If wrong:* One wasted Maps request in places without such markets.
- **Image search goes to Bing Images, not Google Images as the user asked.** Google answered Context.dev with its CAPTCHA page, and working around bot detection is not something to do. *If wrong:* None found; results were good.
- **Photos found by search are downloaded from any public https host, not only allowlisted ones.** The host must be a name, on the default port, with every resolved address public, and redirects are not followed; client-supplied photo URLs stay on the allowlist. *If wrong:* A wider fetch surface for the local server (DNS rebinding between the check and the fetch is not closed).
- **A found photo is used when its title or address names the place or just its city.** Requiring the place itself left most searches empty. *If wrong:* A seasonal photo of the right city but not the exact place can appear behind a place's name.
- **These photos are other people's; nothing checks their licence.** Said in the README and to the user. *If wrong:* Not usable beyond a demo without a licensed source.
- **Only outdoor interests in a non-mild season get an image search (nature, adventure, water, history, family, shopping, events, gems).** Saves Context.dev requests under the 10/min limit and keeps restaurants' own photos. *If wrong:* A museum or restaurant exterior can still look off-season.
- **When the usual weather cannot be fetched, a winter stay beyond 40° latitude is now treated as cold (reverses the earlier "assume nothing" ruling in part).** The archive stalled once on the user's own run and the video came out with green parks. *If wrong:* Winter searches in a mild-winter city far north or south; the fallback search covers it.

## Things to do, by season

- **Read "a lot more details" as both more activity types and more shown about each (kind, review count, description, bookable offer with price).** The request can be read either way. *If wrong:* The scenes are denser than the user wants; the note and offer row are each one line to remove in assemble.ts.
- **At most four place searches per video and three activity scenes, as before.** The 10 requests/minute allowance and the 30-second limit. *If wrong:* An active person sees three activities, not all six of the season.
- **Only Maps' first two results count for an activity, and an activity found nowhere nearby gets no scene (no quad scene in Innsbruck, no rafting in Albufeira).** Showing the fifth result gave "Ski & snowboard — Bergisel Ski Jump". *If wrong:* A real place listed third is missed.
- **Operator-run activities (rafting, quad, paragliding, kayak, climbing, biking, boat, adventure park, ice rink) need the place to name the activity itself; the others (ski, sledding, snowshoe, cross-country, hiking, viewpoint, swimming, thermal, pool) are only dropped when the name is another activity's.** "Rumer Alm" is a real toboggan run that says so nowhere. *If wrong:* A paragliding school called "Fly Tirol" is dropped; a wrongly placed sledding or viewpoint scene can still appear.
- **The offer beside an activity may be barely reviewed or unrated (never below 4.3 when rated).** Niche offers have no reviews. *If wrong:* An untested tour is shown with its price next to a well-rated place. The offer is for the activity in the area, not necessarily at that place; its own title says where.
- **Drive time is 30/60/80 km/h by distance band, rounded to 5 min above 20.** The flat 30 km/h said 89 minutes for a 45-minute drive. *If wrong:* Still an estimate from straight-line distance; a mountain pass or a ferry is not seen.
- **Swimming is listed under Adventure & sports in summer (second, after quad & buggy).** The user named it among what an active person does. *If wrong:* One adventure search goes to a beach or lake.
- **(High) "a place that says nothing of the activity still gets the activity label and voiceover" is not fixed as proposed (label only when the place itself names the activity).** That would drop Rumer Alm, a real toboggan run that Maps lists first and that says so nowhere. Tightened instead: such a place is taken only as Maps' first in-season answer, never as the second ("trusts a place that says nothing of the activity only as the first answer Maps gave" RED→GREEN). *If wrong:* Where an un-operated activity (sledding, snowshoe, hiking, viewpoint, swimming, ski, cross-country, thermal, pool) does not exist nearby, Maps' first result can be shown under its label.
- **No distance check on the offer beside an activity.** Marketplace cards carry no coordinates. *If wrong:* A ski day in another valley is shown beside the nearest ski area; the README says the offer is for the area.

## Landing page, release and hosting

- **Built straight away without a design round-trip.** The request named the content, the style and the address, and the user is against the clock; the page is cheap to change once seen. *If wrong:* Copy or layout the user would have steered differently.
- **The server itself serves the page and the zip (one process, one origin), with a reverse proxy only for HTTPS.** Fewest moving parts on a VPS whose details are not known yet. *If wrong:* A static host or CDN in front would need the files copied there instead.
- **The release build goes to apps/extension/dist-release, not dist.** The user's Chrome has dist loaded and must keep talking to localhost. *If wrong:* None found.
- **The example video shows Wikimedia Commons photos, not the ones the product found.** Those belong to Google Maps contributors, marketplaces and an Airbnb host, and a public page would be republishing them. *If wrong:* The demo is slightly less literal; two scenes (Zirbenweg, Rumer Alm) show the mountain the place is on, which the page's footer says. The outro no longer lists Bing Images, since none of its photos is shown.
- **No deployment files (Docker, proxy config, service unit) yet.** The user said the VPS details are coming. *If wrong:* A few minutes once they are known. README has the plain-Node way to run it.
- **The caps are on by default (120 per visitor per hour, 4 at once, 1500 a day) although the user had only been asked, not answered.** A public server holding paid keys should not wait for that answer to be safe; all three are settings. *If wrong:* Judges behind one venue address share 120 new videos an hour; raise VIDEO_BUILDS_PER_VISITOR_PER_HOUR.
- **DNS is resolved once to vet a found photo's host and again by fetch (rebinding window).** Pinning the vetted address needs a custom connection layer; only image-search results take that path, never a client's URL. *If wrong:* A hostile image host could answer the second lookup with a private address.
- **Total disk use for mirrored media is bounded only by the build caps and the six-hour sweep, not by bytes.** *If wrong:* A burst of builds fills more disk than expected until the sweep.
- **The deploy script is run by the person deploying, who types the two passwords it needs; no tool, script or file in the repository holds a password or a key.** Logging in with someone's password and placing their API keys are theirs to do. *If wrong:* One command the deployer has to run themselves.

## The promotional film

- **The film is complete without the narrator.** Her lines are captions, and she is heard only once every line is recorded (one spoken line then silence sounds broken); the product's own narration plays in the middle. *If wrong:* The user wanted to wait for the full voice-over instead; `voiceover` then `render` gives it.
- **Narrator is "Lily" (British, eleven_multilingual_v2), not George.** George is the voice inside the product, and two voices tell the viewer who is speaking. *If wrong:* One setting (PROMO_VOICE_ID) and a re-voice.
- **The opening is a real screenshot of a real Airbnb listing with the extension's own badge component drawn where it sat, not a raw screen recording.** A recording at 2x would be low-frame-rate and could not be re-timed to the narration; the stages shown are the server's own, faster than the 10.4 s the build took. *If wrong:* Someone expects raw footage; scripts/capture.mjs records what was real.
- **The frame stops above the host's name and photo, the translation note is closed, the cookie banner is left unanswered (below the frame).** A private person's name and face do not belong in a promotional film. *If wrong:* None.
- **The product video inside the film uses the landing page's Wikimedia Commons photos, not the ones the server found live.** Same reason as on the landing page. *If wrong:* As there. The listing's own photos (the host's) are visible in the opening, as in any demonstration of the extension on Airbnb; said to the user.
- **No music.** Nothing licensed is at hand and none was asked for. *If wrong:* The film is quieter than a typical promo; a track can be laid under it in one <Audio>.

## Known gaps, left as they are

Smaller things that were noticed and deliberately not done.

- Popup says "No listing in this tab" on a listing when the server started after the page loaded; its Retry only re-checks health.
- Neither adapter reads the listing's currency, so prices are always fetched in euros.
- Airbnb language subdomains (es.airbnb.com) get no badge.
- A form-encoded POST answers 500, an over-long media name answers Fastify's own 414 body.
- No Host header check (DNS rebinding could start builds); any chrome-extension origin is allowed; the video cache trusts the client's listing id.
- Context.dev and Open-Meteo forecast calls carry no timeout of their own.
- ParsePrice alone misreads "€ 1 000", "TOP 10 tours from €45", "R$ 45"; not reachable through today's callers.
- Eight functions exceed 50 lines (PlayerApp, createPageController, Popup…); exported components declare no return type.
- Fixture-mode fallback is not documented; wiring.ts, index.ts and PlayerApp.tsx have no unit tests.
- Weather uses the UTC date as "today"; a date change rebuilds from scratch instead of showing "refreshing".
- The badge's z-index (see ruling above).
- Two scenes can carry the same activity label when another activity found nothing (two "Swimming" beaches in Albufeira).
- Maps' description is shown as written, so a winter scene can mention "summer roses".
- The voice does not read the offer or the description; they are on screen only.
- `_stored` in forAsker is an unused destructured name; no unit test for the 2,000 m walk/drive jump (33 min walk vs 6 min drive, as before this change).
- The page is English only; no dark theme (the approved look is light); og.jpg is a crop of the demo's ski scene, not a designed card.
- Failed jobs are never removed from the in-memory job store; listing title and location reach the model's prompt as text (the accuracy guard still vets every number); startDemo is one long closure (about 130 lines); the contour rings keep rotating off-screen; no HSTS from the server itself (the proxy's job); symbolic links inside the site folder are followed.
- 192 kbps voice needs a higher ElevenLabs plan (128 kbps used); the pointer is drawn, not captured; no 9:16 cut.
