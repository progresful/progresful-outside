import type { ClimateFact, EventFact, ExperienceFact, Fact, PlaceFact, SceneType, WeatherFact } from '@outside/shared';
import type { SeasonPhoto } from '../sources/seasonPhoto';
import { z } from 'zod';
import { venueName } from '../sources/events';
import { formatPrice } from '../sources/price';
import type { TripWindow } from '../sources/tripWindow';
import { precipitationWord } from '../sources/weather';
import type { NormalizedPlace } from './normalize';
import { spokenTravel } from './select';
import { MAX_WORDS_PER_LINE, validateLines } from './validateScript';

export interface PlannedScene {
  type: SceneType;
  factIds: string[];
}

export interface StoryScene extends PlannedScene {
  line: string;
}

/** Everything the video may talk about, already chosen in code. */
export interface Selection {
  place: NormalizedPlace;
  window: TripWindow;
  places: PlaceFact[];
  experiences: ExperienceFact[];
  events: EventFact[];
  weather: WeatherFact[];
  /** What the weather is usually like at this time of year; at most one. Opens the video. */
  climate: ClimateFact[];
  /** Photos of the place in season, best first: the first opens the video. */
  seasonPhotos: SeasonPhoto[];
}

/** Sends a system and user prompt, returns the model's JSON matching the schema. Injected for tests. */
export type Complete = (system: string, user: string, jsonSchema: object) => Promise<unknown>;

/**
 * About 25 seconds of speech at the voice's measured pace (2.3 words a second with the pauses
 * between scenes), so even a script that uses the validator's slack stays inside 30 seconds.
 */
export const DEFAULT_WORD_BUDGET = 58;
const MIN_WORDS_PER_LINE = 8;
const LINE_HEADROOM_WORDS = 2;
const MAX_EXPERIENCES = 3;
const MAX_ATTEMPTS = 2;

export const LINES_JSON_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
  additionalProperties: false,
} as const;

const LinesSchema = z.object({ lines: z.array(z.string()) });

export function factMap(sel: Selection): Map<string, Fact> {
  const all: Fact[] = [...sel.places, ...sel.experiences, ...sel.events, ...sel.weather, ...sel.climate];
  return new Map(all.map((fact) => [fact.id, fact]));
}

/** The scenes and the facts each may use. Decided here, in code, never by the model. */
export function planScenes(sel: Selection): PlannedScene[] {
  const cheapestFirst = [...sel.experiences].sort((a, b) => a.amount - b.amount).slice(0, MAX_EXPERIENCES);
  const stayFact = sel.events[0] ?? sel.weather[0];
  return [
    { type: 'hook', factIds: sel.climate.slice(0, 1).map((climate) => climate.id) },
    ...sel.places.map((place): PlannedScene => ({ type: 'activity', factIds: [place.id] })),
    ...(cheapestFirst.length > 0
      ? [{ type: 'experiences' as const, factIds: cheapestFirst.map((experience) => experience.id) }]
      : []),
    ...(stayFact ? [{ type: 'stay' as const, factIds: [stayFact.id] }] : []),
    { type: 'outro', factIds: [] },
  ];
}

/** "minus 19" rather than "-19": a voice reads the word, and the guard checks the sign. */
function spokenDegrees(celsius: number): string {
  return celsius < 0 ? `minus ${Math.abs(celsius)}` : String(celsius);
}

function describeFact(fact: Fact): Record<string, unknown> {
  switch (fact.kind) {
    case 'place':
      return {
        name: fact.name,
        ...(fact.category ? { what: fact.category } : {}),
        ...(fact.description ? { about: fact.description } : {}),
        rating: fact.rating,
        reviews: fact.reviewCount,
        travel: spokenTravel(fact.distanceM),
      };
    case 'experience':
      return { title: fact.title, price: formatPrice(fact.amount, fact.currency), duration: fact.durationText };
    case 'event':
      return { title: fact.title, when: fact.dateText, ...(venueName(fact.venue) ? { where: venueName(fact.venue) } : {}) };
    case 'climate':
      return {
        month: fact.month,
        usualLow: `${spokenDegrees(fact.tempMinC)} °C`,
        usualHigh: `${spokenDegrees(fact.tempMaxC)} °C`,
        usually: fact.conditions,
      };
    case 'weather':
      return {
        low: `${spokenDegrees(fact.tempMinC)} °C`,
        high: `${spokenDegrees(fact.tempMaxC)} °C`,
        [`${precipitationWord(fact)}ChancePercent`]: fact.precipitationChance,
      };
  }
}

/** Models keep to a per-line limit far better than to a total, so the budget is shared out per scene. */
function wordsPerLine(sceneCount: number, wordBudget: number): number {
  const share = Math.floor(wordBudget / Math.max(1, sceneCount)) + LINE_HEADROOM_WORDS;
  return Math.min(MAX_WORDS_PER_LINE, Math.max(MIN_WORDS_PER_LINE, share));
}

/** "Lisbon, Portugal", or just "Lisbon" when the listing gave no separate country. */
function whereabouts(place: NormalizedPlace): string {
  return place.country && place.country !== place.city ? `${place.city}, ${place.country}` : place.city;
}

/** How many words the opening line may run to when it also has to set the season. */
const SEASON_OPENING_WORDS = 16;

function systemPrompt(sceneCount: number, place: NormalizedPlace, wordBudget: number, month: string | undefined): string {
  const when = month ? `, for a stay in ${month}` : '';
  const opening = month
    ? `- The first line sets the scene: ${place.city} in ${month} and what the weather is usually like then, from its facts. It may use up to ${SEASON_OPENING_WORDS} words.`
    : '- The first line hooks. It has no facts, so no numbers in it.';
  return [
    `You write the voiceover for a short, upbeat travel video about what is around a holiday rental in ${whereabouts(place)}${when}.`,
    `Return exactly ${sceneCount} lines, one per scene, in scene order.`,
    'How to write:',
    '- Sound like a friend who knows the area: warm, concrete, a little excited. Plain spoken English.',
    '- Activity scenes: say what the place is and how close it is; the rating may back it up. Start each one differently.',
    '- Experiences scene: one or two of the offers. Name the offer in a few plain words, then its own price, like "a Sintra day trip from €59".',
    '- Stay scene: what is on, or what weather to expect, while the guest is there.',
    opening,
    ...(month ? [`- Let the other lines suit ${month} too, in their wording only: add no fact that is not listed.`] : []),
    '- The last line invites. It has no facts, so no numbers in it.',
    'Hard rules:',
    '- Use only the facts listed for that scene. Never invent a name, number, price or time.',
    '- Describe a place only by the facts given; do not invent details about it.',
    '- Write numbers as digits and copy them exactly as given.',
    '- Keep the names of places, venues and performers exactly as given. A long tour title may be cut down to its subject.',
    '- Never say "open now", "right now", "today", "tonight" or "this evening".',
    '- No hashtags, no emoji, no symbols.',
    `- At most ${wordsPerLine(sceneCount, wordBudget)} words per line, about ${wordBudget} words in total. Shorter is better.`,
  ].join('\n');
}

function userPrompt(plan: readonly PlannedScene[], facts: ReadonlyMap<string, Fact>, problems: readonly string[]): string {
  const scenes = plan.map((scene, index) => ({
    scene: index + 1,
    type: scene.type,
    facts: scene.factIds.flatMap((id) => {
      const fact = facts.get(id);
      return fact ? [describeFact(fact)] : [];
    }),
  }));
  const retry =
    problems.length > 0 ? `\n\nYour previous attempt was rejected. Fix these:\n- ${problems.join('\n- ')}` : '';
  return `${JSON.stringify({ scenes }, null, 2)}${retry}`;
}

/** Asks the model for one voiceover line per planned scene. Throws if the reply is not a list of strings. */
export async function writeLines(
  complete: Complete,
  plan: readonly PlannedScene[],
  facts: ReadonlyMap<string, Fact>,
  place: NormalizedPlace,
  wordBudget: number,
  problems: readonly string[] = [],
): Promise<string[]> {
  const month = plan.flatMap((scene) => scene.factIds.flatMap((id) => facts.get(id) ?? [])).find((fact) => fact.kind === 'climate')?.month;
  const reply = await complete(systemPrompt(plan.length, place, wordBudget, month), userPrompt(plan, facts, problems), LINES_JSON_SCHEMA);
  return LinesSchema.parse(reply).lines;
}

/** How much of a tour title the fallback script reads out. */
const TEMPLATE_TITLE_WORDS = 7;

function templateLine(scene: PlannedScene, facts: ReadonlyMap<string, Fact>, place: NormalizedPlace): string {
  const fact = facts.get(scene.factIds[0] ?? '');
  if (scene.type === 'hook') {
    return fact?.kind === 'climate'
      ? `${place.city} in ${fact.month}: usually ${spokenDegrees(fact.tempMinC)} to ${spokenDegrees(fact.tempMaxC)} degrees, ${fact.conditions}.`
      : `Step outside in ${place.city}.`;
  }
  if (fact?.kind === 'place') {
    return `${fact.name} is rated ${fact.rating}, ${spokenTravel(fact.distanceM)}.`;
  }
  if (fact?.kind === 'experience') {
    return `${fact.title.split(/\s+/).slice(0, TEMPLATE_TITLE_WORDS).join(' ')}, from ${formatPrice(fact.amount, fact.currency)}.`;
  }
  if (fact?.kind === 'event') {
    return `Coming up: ${fact.title}, ${fact.dateText}.`;
  }
  if (fact?.kind === 'weather') {
    return `Expect ${spokenDegrees(fact.tempMinC)} to ${spokenDegrees(fact.tempMaxC)} degrees.`;
  }
  return 'That is what is outside.';
}

/** A fixed script built straight from the facts, used when the model cannot produce a valid one. */
export function templateLines(
  plan: readonly PlannedScene[],
  facts: ReadonlyMap<string, Fact>,
  place: NormalizedPlace,
): string[] {
  return plan.map((scene) => templateLine(scene, facts, place));
}

function toScenes(plan: readonly PlannedScene[], lines: readonly string[]): StoryScene[] {
  return plan.map((scene, index) => ({ ...scene, line: lines[index] ?? '' }));
}

/**
 * Model lines if they survive the accuracy guard, with one retry that tells the model what was
 * wrong; otherwise the template. `onFallback` reports why the model's script was not used.
 */
export async function scriptWithGuard(
  complete: Complete,
  sel: Selection,
  wordBudget: number = DEFAULT_WORD_BUDGET,
  onFallback?: (reasons: readonly string[]) => void,
): Promise<StoryScene[]> {
  const plan = planScenes(sel);
  const facts = factMap(sel);
  let problems: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const lines = await writeLines(complete, plan, facts, sel.place, wordBudget, problems);
      const verdict = validateLines(lines, plan, facts, wordBudget);
      if (verdict.ok) {
        return toScenes(plan, lines);
      }
      problems = verdict.reasons;
    } catch (error: unknown) {
      problems = [`The model call failed: ${error instanceof Error ? error.message : 'unknown error'}`];
    }
  }
  onFallback?.(problems);
  return toScenes(plan, templateLines(plan, facts, sel.place));
}
