import { describe, expect, it, vi } from 'vitest';
import { LINES_JSON_SCHEMA, factMap, planScenes, scriptWithGuard, templateLines, writeLines } from '../src/pipeline/script';
import { validateLines } from '../src/pipeline/validateScript';
import { placeFact, selection } from './fixtures/selection';

const sel = selection();
const plan = planScenes(sel);
const facts = factMap(sel);

/** One valid line per planned scene of the default selection. */
const goodLines = [
  'Step outside in Lisbon.',
  'Mercado da Ribeira is rated 4.5 and about 13 minutes on foot.',
  'Museu do Azulejo, rated 4.7 by 9,000 visitors, is a 25 minute walk.',
  'Parque Eduardo VII is a 7 minute drive.',
  'A sunset cruise starts from €30, a food tour from €45.',
  'The Christmas market runs 12–24 Dec.',
  'That is what is outside.',
];

function withLine(index: number, line: string): string[] {
  return goodLines.map((existing, i) => (i === index ? line : existing));
}

describe('planScenes', () => {
  it('plans hook, activities, experiences, stay, outro in order', () => {
    expect(plan.map((scene) => scene.type)).toEqual([
      'hook', 'activity', 'activity', 'activity', 'experiences', 'stay', 'outro',
    ]);
    expect(plan[1]?.factIds).toEqual(['place:market']);
  });

  it('lists experiences cheapest first and prefers an event for the stay scene', () => {
    expect(plan[4]?.factIds).toEqual(['exp:cruise', 'exp:tour']);
    expect(plan[5]?.factIds).toEqual(['event:market']);
  });

  it('uses the weather for the stay scene when there is no event', () => {
    const stay = planScenes(selection({ events: [] })).find((scene) => scene.type === 'stay');
    expect(stay?.factIds).toEqual(['weather:stay']);
  });

  it('omits experiences and stay when there are no such facts', () => {
    const types = planScenes(selection({ experiences: [], events: [], weather: [] })).map((scene) => scene.type);
    expect(types).toEqual(['hook', 'activity', 'activity', 'activity', 'outro']);
  });

  it('shows at most three experiences', () => {
    const many = ['a', 'b', 'c', 'd'].map((id, i) => ({ ...sel.experiences[0]!, id: `exp:${id}`, amount: 10 + i }));
    const scene = planScenes(selection({ experiences: many })).find((s) => s.type === 'experiences');
    expect(scene?.factIds).toEqual(['exp:a', 'exp:b', 'exp:c']);
  });
});

describe('validateLines', () => {
  it('accepts lines whose numbers all come from the facts of their scene', () => {
    expect(validateLines(goodLines, plan, facts, 50)).toEqual({ ok: true });
  });

  it('rejects an invented price', () => {
    const result = validateLines(withLine(4, 'Tours start from €39.'), plan, facts, 50);
    expect(result).toEqual({ ok: false, reasons: [expect.stringContaining('39')] });
  });

  it('rejects a number that belongs to another scene', () => {
    const result = validateLines(withLine(1, 'Mercado da Ribeira is rated 4.7.'), plan, facts, 50);
    expect(result.ok).toBe(false);
  });

  it('rejects any number in the hook, which has no facts', () => {
    expect(validateLines(withLine(0, 'Lisbon, 5 minutes from everything.'), plan, facts, 50).ok).toBe(false);
  });

  it.each(['open now', 'Open right now', 'today', 'tonight', 'this evening'])('rejects the phrase %j', (phrase) => {
    const result = validateLines(withLine(1, `Mercado da Ribeira is worth it ${phrase}.`), plan, facts, 50);
    expect(result.ok).toBe(false);
  });

  it.each(['twenty minutes away', 'five euros a head', 'a hundred steps'])('rejects the spelled-out number in %j', (text) => {
    expect(validateLines(withLine(1, `Mercado da Ribeira, ${text}.`), plan, facts, 50).ok).toBe(false);
  });

  it('allows digits that are part of a place name', () => {
    const named = selection({ places: [placeFact('market', { name: 'Pastelaria 1837' }), sel.places[1]!, sel.places[2]!] });
    const lines = withLine(1, 'Pastelaria 1837 is rated 4.5.');
    expect(validateLines(lines, planScenes(named), factMap(named), 50)).toEqual({ ok: true });
  });

  it('rejects the wrong number of lines', () => {
    const result = validateLines(goodLines.slice(1), plan, facts, 50);
    expect(result).toEqual({ ok: false, reasons: [expect.stringContaining('7 lines')] });
  });

  it('rejects an empty line', () => {
    expect(validateLines(withLine(6, '  '), plan, facts, 50).ok).toBe(false);
  });

  it('rejects a line over 22 words', () => {
    const long = `Lisbon ${Array(22).fill('really').join(' ')}.`;
    expect(validateLines(withLine(0, long), plan, facts, 80).ok).toBe(false);
  });

  it('rejects a script more than 10 words over budget', () => {
    expect(validateLines(goodLines, plan, facts, 30).ok).toBe(false);
  });
});

describe('templateLines', () => {
  it.each([
    ['everything', selection()],
    ['weather only', selection({ experiences: [], events: [] })],
    ['places only', selection({ experiences: [], events: [], weather: [] })],
  ])('passes validation with %s', (_name, s) => {
    const p = planScenes(s);
    expect(validateLines(templateLines(p, factMap(s), s.place), p, factMap(s), 50)).toEqual({ ok: true });
  });
});

describe('writeLines', () => {
  it('asks for one line per scene with a strict schema and the word budget', async () => {
    const complete = vi.fn().mockResolvedValue({ lines: goodLines });

    expect(await writeLines(complete, plan, facts, sel.place, 50)).toEqual(goodLines);

    const [system, user, schema] = complete.mock.calls[0] as [string, string, object];
    expect(system).toContain('50 words');
    expect(system).toContain('exactly 7 lines');
    expect(user).toContain('Alfama food tour');
    expect(user).toContain('€45');
    expect(schema).toBe(LINES_JSON_SCHEMA);
  });

  it('throws when the model does not return a list of strings', async () => {
    await expect(writeLines(vi.fn().mockResolvedValue({ lines: [1, 2] }), plan, facts, sel.place, 50)).rejects.toThrow();
  });
});

describe('scriptWithGuard', () => {
  it('uses the model lines when they pass', async () => {
    const complete = vi.fn().mockResolvedValue({ lines: goodLines });

    const scenes = await scriptWithGuard(complete, sel);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(scenes.map((scene) => scene.line)).toEqual(goodLines);
    expect(scenes[1]).toEqual({ type: 'activity', factIds: ['place:market'], line: goodLines[1] });
  });

  it('retries once with the reasons, then falls back to the template', async () => {
    const complete = vi.fn().mockResolvedValue({ lines: withLine(1, 'Mercado da Ribeira is open now.') });

    const scenes = await scriptWithGuard(complete, sel);

    expect(complete).toHaveBeenCalledTimes(2);
    expect((complete.mock.calls[1] as [string, string])[1]).toContain('open now');
    expect(validateLines(scenes.map((scene) => scene.line), plan, facts, 50)).toEqual({ ok: true });
  });

  it('accepts a corrected second attempt', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ lines: withLine(4, 'Tours start from €39.') })
      .mockResolvedValueOnce({ lines: goodLines });

    expect((await scriptWithGuard(complete, sel)).map((scene) => scene.line)).toEqual(goodLines);
  });

  it('falls back to the template when the model call throws', async () => {
    const scenes = await scriptWithGuard(vi.fn().mockRejectedValue(new Error('timeout')), sel);

    expect(validateLines(scenes.map((scene) => scene.line), plan, facts, 50)).toEqual({ ok: true });
  });
});
