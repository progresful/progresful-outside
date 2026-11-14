import type { EventFact, ExperienceFact, Fact, PlaceFact, SceneType, WeatherFact } from '@outside/shared';
import { z } from 'zod';
import { formatPrice } from '../sources/price';
import type { TripWindow } from '../sources/tripWindow';
import type { NormalizedPlace } from './normalize';
import { travelLabel } from './select';
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
}

/** Sends a system and user prompt, returns the model's JSON matching the schema. Injected for tests. */
export type Complete = (system: string, user: string, jsonSchema: object) => Promise<unknown>;

export const DEFAULT_WORD_BUDGET = 50;
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
  const all: Fact[] = [...sel.places, ...sel.experiences, ...sel.events, ...sel.weather];
  return new Map(all.map((fact) => [fact.id, fact]));
}

/** The scenes and the facts each may use. Decided here, in code, never by the model. */
export function planScenes(sel: Selection): PlannedScene[] {
  const cheapestFirst = [...sel.experiences].sort((a, b) => a.amount - b.amount).slice(0, MAX_EXPERIENCES);
  const stayFact = sel.events[0] ?? sel.weather[0];
  return [
    { type: 'hook', factIds: [] },
    ...sel.places.map((place): PlannedScene => ({ type: 'activity', factIds: [place.id] })),
    ...(cheapestFirst.length > 0
      ? [{ type: 'experiences' as const, factIds: cheapestFirst.map((experience) => experience.id) }]
      : []),
    ...(stayFact ? [{ type: 'stay' as const, factIds: [stayFact.id] }] : []),
    { type: 'outro', factIds: [] },
  ];
}

function describeFact(fact: Fact): Record<string, unknown> {
  switch (fact.kind) {
    case 'place':
      return { name: fact.name, rating: fact.rating, reviews: fact.reviewCount, travel: travelLabel(fact.distanceM) };
    case 'experience':
      return { title: fact.title, price: formatPrice(fact.amount, fact.currency), duration: fact.durationText };
    case 'event':
      return { title: fact.title, when: fact.dateText };
    case 'weather':
      return { lowC: fact.tempMinC, highC: fact.tempMaxC, rainChancePercent: fact.precipitationChance };
  }
}

function systemPrompt(sceneCount: number, place: NormalizedPlace, wordBudget: number): string {
  return [
    `You write the voiceover for a short travel video about the area around a holiday rental in ${place.city}, ${place.country}.`,
    `Return exactly ${sceneCount} lines, one per scene, in scene order.`,
    'Rules:',
    '- Plain, warm, spoken English. No hashtags, no emoji.',
    '- Use only the facts listed for that scene. Never invent a name, number, price or time.',
    '- Write numbers as digits and copy them exactly as given.',
    '- The hook and outro scenes have no facts: no numbers in them.',
    '- Never say "open now", "right now", "today", "tonight" or "this evening".',
    `- At most ${MAX_WORDS_PER_LINE} words per line, about ${wordBudget} words in total.`,
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
  const reply = await complete(systemPrompt(plan.length, place, wordBudget), userPrompt(plan, facts, problems), LINES_JSON_SCHEMA);
  return LinesSchema.parse(reply).lines;
}

function templateLine(scene: PlannedScene, facts: ReadonlyMap<string, Fact>, place: NormalizedPlace): string {
  const fact = facts.get(scene.factIds[0] ?? '');
  if (scene.type === 'hook') {
    return `Step outside in ${place.city}.`;
  }
  if (fact?.kind === 'place') {
    const label = travelLabel(fact.distanceM);
    const minutes = label.replace(/\D+/g, '');
    return `${fact.name} is rated ${fact.rating}, about ${minutes} minutes ${label.endsWith('walk') ? 'on foot' : 'by car'}.`;
  }
  if (fact?.kind === 'experience') {
    return `Experiences nearby start from ${formatPrice(fact.amount, fact.currency)}.`;
  }
  if (fact?.kind === 'event') {
    return `Coming up: ${fact.title}, ${fact.dateText}.`;
  }
  if (fact?.kind === 'weather') {
    return `Expect ${fact.tempMinC} to ${fact.tempMaxC} degrees.`;
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
