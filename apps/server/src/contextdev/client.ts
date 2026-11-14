import { z } from 'zod';
import { TTL_MS } from '../cache/cacheStore';
import type { FixtureMode } from '../config';
import { readFixture, writeFixture } from './fixtures';
import { createLimiter, createWindowLimiter } from './limiter';

const BASE_URL = 'https://api.context.dev/v1';
const DEFAULT_MAX_CONCURRENT = 20;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const MAX_JITTER_MS = 250;
const MAX_RETRY_AFTER_S = 60;
const MINUTE_MS = 60_000;

const EMPTY_OUTPUT = { success: null, data: null };

const OutputSchema = z.looseObject({
  success: z.boolean().nullable(),
  data: z.unknown(),
});

const ScrapeResponseSchema = z.looseObject({
  url: z.string().default(''),
  parsed: OutputSchema.default(EMPTY_OUTPUT),
  markdown: OutputSchema.default(EMPTY_OUTPUT),
  json: OutputSchema.default(EMPTY_OUTPUT),
  images: OutputSchema.default(EMPTY_OUTPUT),
  cache_metadata: z
    .looseObject({ status: z.string().default('miss'), age_ms: z.number().default(0) })
    .default({ status: 'miss', age_ms: 0 }),
  key_metadata: z
    .looseObject({ credits_consumed: z.number().optional(), credits_remaining: z.number().optional() })
    .optional(),
});

export type ScrapeOutput = z.infer<typeof OutputSchema>;
export type ScrapeResponse = z.infer<typeof ScrapeResponseSchema>;

export interface ContextDevClient {
  scrape(body: Record<string, unknown>): Promise<ScrapeResponse>;
  /** The search response shape is recorded in docs/spikes/2026-11-14-sources.md; callers narrow it. */
  search(body: Record<string, unknown>): Promise<unknown>;
}

export interface ContextDevClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  maxConcurrent?: number;
  /** The account's requests-per-minute allowance. Requests beyond it wait instead of being rejected. */
  maxPerMinute?: number;
  fixtures?: { mode: FixtureMode; dir: string };
}

export class ContextDevError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ContextDevError';
  }
}

export class CreditsExhaustedError extends ContextDevError {
  constructor() {
    super(402, 'Context.dev credits are exhausted');
    this.name = 'CreditsExhaustedError';
  }
}

/** When the data was really fetched: now, minus however long Context.dev had it cached. */
export function realFetchedAt(res: { cache_metadata?: { age_ms?: number } }, now: number): number {
  return now - (res.cache_metadata?.age_ms ?? 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res: Response): number {
  const seconds = Number(res.headers.get('retry-after'));
  const bounded = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_RETRY_AFTER_S) : 1;
  return bounded * 1000 + Math.random() * MAX_JITTER_MS;
}

async function requestWithRetry(
  fetchFn: typeof fetch,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
  beforeAttempt: () => Promise<void>,
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    await beforeAttempt();
    const res = await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      return (await res.json()) as unknown;
    }
    if (res.status === 402) {
      throw new CreditsExhaustedError();
    }
    if (res.status !== 429 || attempt >= MAX_ATTEMPTS) {
      throw new ContextDevError(res.status, `Context.dev ${path} failed with status ${res.status}`);
    }
    await sleep(retryDelayMs(res));
  }
}

function withScrapeDefaults(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    maxAgeMs: body.maxAgeMs ?? TTL_MS,
    timeoutOpts: body.timeoutOpts ?? { milliseconds: DEFAULT_TIMEOUT_MS, behavior: 'fail' },
  };
}

export function createContextDevClient(options: ContextDevClientOptions): ContextDevClient {
  const fetchFn = options.fetch ?? fetch;
  const limit = createLimiter(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const fixtures = options.fixtures ?? { mode: 'off' as const, dir: '' };
  const minuteAllowance =
    options.maxPerMinute === undefined
      ? (): Promise<void> => Promise.resolve()
      : createWindowLimiter({ max: options.maxPerMinute, windowMs: MINUTE_MS });

  const post = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    if (fixtures.mode === 'replay') {
      return readFixture(fixtures.dir, path, body);
    }
    const result = await limit(() => requestWithRetry(fetchFn, options.apiKey, path, body, minuteAllowance));
    if (fixtures.mode === 'record') {
      writeFixture(fixtures.dir, path, body, result);
    }
    return result;
  };

  return {
    async scrape(body: Record<string, unknown>): Promise<ScrapeResponse> {
      return ScrapeResponseSchema.parse(await post('/web/scrape', withScrapeDefaults(body)));
    },
    search(body: Record<string, unknown>): Promise<unknown> {
      return post('/web/search', body);
    },
  };
}
