/**
 * Throwaway: which OpenAI model writes a valid voiceover fastest.
 * Run from apps/server: tsx --env-file=<repo>/.env ../../spikes/models.mts
 */
import { LINES_JSON_SCHEMA, factMap, planScenes } from '../apps/server/src/pipeline/script';
import { validateLines } from '../apps/server/src/pipeline/validateScript';
import { selection, tour, cruise, christmasMarket, weather } from '../apps/server/test/fixtures/selection';

const sel = selection({ experiences: [tour, cruise], events: [christmasMarket], weather: [weather] });
const plan = planScenes(sel);
const facts = factMap(sel);

// Same prompts the pipeline sends (kept in sync by hand; this file is throwaway).
const scriptModule = await import('../apps/server/src/pipeline/script');
let captured: { system: string; user: string } = { system: '', user: '' };
await scriptModule
  .writeLines(async (system, user) => {
    captured = { system, user };
    return { lines: [] };
  }, plan, facts, sel.place, 65)
  .catch(() => undefined);

const VARIANTS: Array<{ model: string; extra: Record<string, unknown> }> = [
  { model: 'gpt-5.4-mini', extra: { reasoning_effort: 'none' } },
  { model: 'gpt-6-sol', extra: { reasoning_effort: 'none' } },
  { model: 'gpt-6.1-terra', extra: { reasoning_effort: 'none' } },
  { model: 'gpt-6-luna', extra: { reasoning_effort: 'none' } },
  { model: 'gpt-5.5', extra: { reasoning_effort: 'none' } },
];

async function once(model: string, extra: Record<string, unknown>): Promise<string> {
  const started = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: captured.system },
        { role: 'user', content: captured.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'voiceover_lines', strict: true, schema: LINES_JSON_SCHEMA } },
      ...extra,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const ms = Date.now() - started;
  const json = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string }; usage?: { completion_tokens?: number } } | null;
  if (!res.ok) {
    return `ERR ${res.status} ${String(json?.error?.message ?? '').slice(0, 140)}`;
  }
  const lines = (JSON.parse(json?.choices?.[0]?.message?.content ?? '{"lines":[]}') as { lines: string[] }).lines;
  const verdict = validateLines(lines, plan, facts, 65);
  return `${ms} ms, out ${json?.usage?.completion_tokens} tok, ${verdict.ok ? 'VALID' : `INVALID ${verdict.reasons.join(' | ')}`}\n      ${lines.join('\n      ')}`;
}

for (const { model, extra } of VARIANTS) {
  const label = `${model} ${JSON.stringify(extra)}`;
  for (let run = 1; run <= 4; run += 1) {
    const out = await once(model, extra).catch((error: unknown) => `FAIL ${error instanceof Error ? error.message : 'unknown'}`);
    console.log(`## ${label} run ${run}: ${out}`);
    if (out.startsWith('ERR')) break;
  }
}
