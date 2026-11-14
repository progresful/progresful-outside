/** Throwaway: fetch pages as markdown through Context.dev. Usage: tsx md.mts <country> <name>=<url> ... */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const [country = 'DE', ...pairs] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
await Promise.all(
  pairs.map(async (pair) => {
    const at = pair.indexOf('=');
    const name = pair.slice(0, at);
    const url = pair.slice(at + 1);
    const started = Date.now();
    const res = await fetch('https://api.context.dev/v1/web/scrape', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CONTEXT_DEV_API_KEY ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: { markdown: true },
        markdownParams: { includeImages: true },
        sharedParams: { country },
        timeoutOpts: { milliseconds: 30_000, behavior: 'fail' },
      }),
    });
    const json = (await res.json().catch(() => null)) as { markdown?: { success?: boolean; data?: string }; url?: string; key_metadata?: { credits_consumed?: number } } | null;
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(json, null, 2));
    console.log(`${name}: status ${res.status}, ${Date.now() - started} ms, credits ${json?.key_metadata?.credits_consumed}, success ${json?.markdown?.success}, length ${json?.markdown?.data?.length ?? 0}, final url ${json?.url}`);
  }),
);
