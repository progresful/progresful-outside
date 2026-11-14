import type { ExperienceFact, Fact } from '@outside/shared';

/** The voiceover is recorded once and replayed for hours, so it must not claim anything about "now". */
const STALE_PHRASE =
  /\b(open now|now open|right now|today|tonight|tomorrow|this (?:evening|morning|afternoon|weekend|week)|currently open|open until|open late|until midnight)\b/i;
/** A size or a price said without its figure cannot be checked against a fact. */
const UNBACKED_CLAIM =
  /\b(hundreds|thousands|dozens|millions|half an hour|quarter of an hour|a few minutes|a couple of|for free|free of charge|free entry|free admission|free to enter)\b/i;
const SPELLED_LARGE =
  /\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/i;
const SPELLED_WITH_UNIT =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten)[\s-]+(minutes?|mins?|hours?|euros?|dollars?|pounds?|stars?|km|kilomet(?:re|er)s?|miles?|degrees?|percent)\b/i;

/** "May" is left out: as a month it cannot be told from the verb. */
const MONTHS = ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_IN_LINE = new RegExp(`\\b(${MONTHS.join('|')})\\b`, 'gi');
/** Facts also abbreviate: "12–24 Dec". */
const MONTH_IN_FACT =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi;
const MONTH_KEY_LENGTH = 3;

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;
const TOLERANCE = 1e-9;
const MIN_DISTINCTIVE_LENGTH = 4;
/** Words too common in tour titles to tell one offer from another. */
const GENERIC_TITLE_WORDS = new Set([
  'tour', 'tours', 'trip', 'trips', 'from', 'with', 'and', 'the', 'day', 'days', 'ticket', 'tickets', 'guided', 'private',
  'small', 'group', 'full', 'half', 'experience', 'city', 'walking', 'entry', 'entrance', 'return', 'roundtrip', 'including',
  'visit', 'best', 'hour', 'hours', 'skip', 'line',
]);

function toNumber(token: string): number {
  const thousands = /^\d{1,3}(,\d{3})+$/.test(token);
  return Number(thousands ? token.split(',').join('') : token.replace(',', '.'));
}

/** The names and other free text of a fact: what a line may quote word for word. */
function factTexts(fact: Fact): string[] {
  switch (fact.kind) {
    case 'place':
      return [fact.name, fact.category ?? '', fact.description ?? ''];
    case 'experience':
      return [fact.title, fact.durationText ?? ''];
    case 'event':
      return [fact.title, fact.venue ?? '', fact.dateText];
    case 'climate':
      return [fact.month];
    case 'weather':
      return [];
  }
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The line with the facts' own names blanked out, so "Twenty One Pilots" is not read as a number. */
function withoutNames(line: string, facts: readonly Fact[]): string {
  const names = facts
    .flatMap((fact) => (fact.kind === 'place' ? [fact.name] : fact.kind === 'experience' ? [fact.title] : fact.kind === 'event' ? [fact.title, fact.venue ?? ''] : []))
    .flatMap((name) => name.split(',').map((part) => part.trim()))
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  return names.reduce((text, name) => text.replace(new RegExp(escapeForRegex(name), 'gi'), ' '), line);
}

function monthKeys(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0].slice(0, MONTH_KEY_LENGTH).toLowerCase());
}

function distinctiveWords(title: string): string[] {
  return (title.toLowerCase().match(/[\p{L}]+/gu) ?? []).filter(
    (word) => word.length >= MIN_DISTINCTIVE_LENGTH && !GENERIC_TITLE_WORDS.has(word),
  );
}

/**
 * With two or more offers in a scene, each price must come right after the offer it belongs to:
 * "a Sintra day trip from €15, or a Fado show from €59". Otherwise prices could be swapped
 * between offers and every number would still be "in the facts".
 */
function priceProblems(line: string, offers: readonly ExperienceFact[], label: string): string[] {
  if (offers.length < 2) {
    return [];
  }
  const problems: string[] = [];
  let from = 0;
  for (const match of line.matchAll(NUMBER_TOKEN)) {
    const value = toNumber(match[0]);
    const priced = offers.filter((offer) => Math.abs(offer.amount - value) < TOLERANCE);
    if (priced.length === 0) {
      continue;
    }
    const said = line.slice(from, match.index).toLowerCase();
    const named = priced.some((offer) => {
      const words = distinctiveWords(offer.title);
      return words.length === 0 || words.some((word) => said.includes(word));
    });
    if (!named) {
      problems.push(`${label}: the price ${match[0]} does not follow the offer it belongs to; name the offer, then its price`);
    }
    from = (match.index ?? 0) + match[0].length;
  }
  return problems;
}

/**
 * What a line claims in words rather than numbers: nothing that goes stale after recording, no
 * size or price without its figure, no month the facts do not name, and no price detached from
 * its offer. `sceneFacts` are the facts of the line's own scene.
 */
export function wordingProblems(line: string, sceneFacts: readonly Fact[], label: string): string[] {
  const own = withoutNames(line, sceneFacts);
  const stale = STALE_PHRASE.exec(own);
  const unbacked = UNBACKED_CLAIM.exec(own);
  const spelled = SPELLED_LARGE.exec(own) ?? SPELLED_WITH_UNIT.exec(own);
  const allowedMonths = new Set(sceneFacts.flatMap((fact) => factTexts(fact)).flatMap((text) => monthKeys(text, MONTH_IN_FACT)));
  const wrongMonth = [...own.matchAll(MONTH_IN_LINE)].find((match) => !allowedMonths.has(match[0].slice(0, MONTH_KEY_LENGTH).toLowerCase()));
  const offers = sceneFacts.filter((fact): fact is ExperienceFact => fact.kind === 'experience');
  return [
    ...(stale ? [`${label}: says "${stale[0].toLowerCase()}", which goes stale after recording`] : []),
    ...(unbacked ? [`${label}: says "${unbacked[0].toLowerCase()}", which no fact backs; use the figures given`] : []),
    ...(spelled ? [`${label}: spells out the number "${spelled[0]}"; use digits from the facts`] : []),
    ...(wrongMonth ? [`${label}: names ${wrongMonth[0]}, a month that is not in the facts for that scene`] : []),
    ...priceProblems(line, offers, label),
  ];
}
