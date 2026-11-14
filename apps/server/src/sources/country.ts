/** Folds case and accents, so "ZÜRICH" and "Zurich" compare equal. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** The ways sites write the countries they abbreviate. Everything else is written out. */
const ALIASES: ReadonlyArray<readonly string[]> = [
  ['united states', 'united states of america', 'usa', 'us'],
  ['united kingdom', 'great britain', 'uk', 'gb'],
  ['united arab emirates', 'uae'],
];

/** Every way a site may write this country, folded; the name itself comes first. */
export function countryNames(country: string): string[] {
  const name = fold(country);
  const group = ALIASES.find((names) => names.includes(name));
  return group ? [name, ...group.filter((other) => other !== name)] : [name];
}

export function sameCountry(a: string, b: string): boolean {
  return countryNames(a).includes(fold(b));
}
