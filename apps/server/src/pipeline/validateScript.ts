import type { Fact } from '@outside/shared';
import type { PlannedScene } from './script';
import { travelLabel } from './select';

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

export const MAX_WORDS_PER_LINE = 22;
const BUDGET_SLACK_WORDS = 10;
const TOLERANCE = 1e-9;

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;
/** The voiceover is recorded once and replayed for hours, so it must not claim anything about "now". */
const STALE_PHRASE = /\b(open now|right now|today|tonight|this evening|currently open)\b/i;
const SPELLED_LARGE =
  /\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const SPELLED_WITH_UNIT =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten)[\s-]+(minutes?|mins?|hours?|euros?|dollars?|pounds?|stars?|km|kilomet(?:re|er)s?|miles?|degrees?|percent)\b/i;

function toNumber(token: string): number {
  const thousands = /^\d{1,3}(,\d{3})+$/.test(token);
  return Number(thousands ? token.split(',').join('') : token.replace(',', '.'));
}

function numberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN) ?? [];
}

function numbersIn(text: string | undefined): number[] {
  return numberTokens(text ?? '').map(toNumber);
}

/** Every number a line about this fact may say: its figures, and any digits inside its own name. */
function allowedNumbers(fact: Fact): number[] {
  switch (fact.kind) {
    case 'place':
      return [
        fact.rating,
        fact.reviewCount,
        ...numbersIn(travelLabel(fact.distanceM)),
        ...numbersIn(fact.name),
        ...numbersIn(fact.description),
      ];
    case 'experience':
      return [fact.amount, ...(fact.rating === undefined ? [] : [fact.rating]), ...numbersIn(fact.title), ...numbersIn(fact.durationText)];
    case 'event':
      return [...numbersIn(fact.title), ...numbersIn(fact.dateText), ...numbersIn(fact.venue)];
    case 'weather':
      return [fact.tempMinC, fact.tempMaxC, fact.precipitationChance];
  }
}

/** "-19", "−19" and "minus 19" all say a negative number; the digits alone do not. */
const MINUS_BEFORE = /(?:-|−|\bminus\s+)$/i;

/**
 * Whether a number in a line is one of the scene's facts. A fact below zero must be said with its
 * minus; a hyphen before a positive fact ("8-17 degrees") is a range, not a sign.
 */
function isAllowed(value: number, textBefore: string, allowed: readonly number[]): boolean {
  const matches = (wanted: number): boolean => allowed.some((fact) => Math.abs(fact - wanted) < TOLERANCE);
  return matches(value) || (MINUS_BEFORE.test(textBefore) && matches(-value));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

function lineProblems(line: string, scene: PlannedScene, facts: ReadonlyMap<string, Fact>, index: number): string[] {
  const label = `Scene ${index + 1}`;
  if (line.trim().length === 0) {
    return [`${label}: the line is empty`];
  }
  const allowed = scene.factIds.flatMap((id) => {
    const fact = facts.get(id);
    return fact ? allowedNumbers(fact) : [];
  });
  const invented = [...line.matchAll(NUMBER_TOKEN)]
    .filter((match) => !isAllowed(toNumber(match[0]), line.slice(0, match.index), allowed))
    .map((match) => `${label}: the number ${match[0]} is not in the facts for that scene`);
  const stale = STALE_PHRASE.exec(line);
  const spelled = SPELLED_LARGE.exec(line) ?? SPELLED_WITH_UNIT.exec(line);
  return [
    ...invented,
    ...(stale ? [`${label}: says "${stale[0].toLowerCase()}", which goes stale after recording`] : []),
    ...(spelled ? [`${label}: spells out the number "${spelled[0]}"; use digits from the facts`] : []),
    ...(wordCount(line) > MAX_WORDS_PER_LINE ? [`${label}: longer than ${MAX_WORDS_PER_LINE} words`] : []),
  ];
}

/**
 * The accuracy guard for the voiceover. A line may only say numbers that belong to the facts of
 * its own scene, and nothing that would be wrong a few hours after recording.
 */
export function validateLines(
  lines: readonly string[],
  plan: readonly PlannedScene[],
  facts: ReadonlyMap<string, Fact>,
  wordBudget: number,
): Verdict {
  if (lines.length !== plan.length) {
    return { ok: false, reasons: [`Expected ${plan.length} lines, got ${lines.length}`] };
  }
  const perLine = plan.flatMap((scene, index) => lineProblems(lines[index] ?? '', scene, facts, index));
  const total = lines.reduce((sum, line) => sum + wordCount(line), 0);
  const limit = wordBudget + BUDGET_SLACK_WORDS;
  const reasons = total > limit ? [...perLine, `The script has ${total} words; the limit is ${limit}`] : perLine;
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
