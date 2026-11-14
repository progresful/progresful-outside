import { z } from 'zod';
import type { Complete } from './script';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 15_000;

const CompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }) }))
    .min(1),
});

export interface OpenAiCompleteOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

/** A `Complete` backed by OpenAI chat completions with strict JSON-schema output. */
export function createOpenAiComplete(options: OpenAiCompleteOptions): Complete {
  const fetchFn = options.fetch ?? fetch;

  return async (system: string, user: string, jsonSchema: object): Promise<unknown> => {
    const res = await fetchFn(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'voiceover_lines', strict: true, schema: jsonSchema } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The response body can echo request details; keep it out of the error.
      throw new Error(`OpenAI responded with status ${res.status}`);
    }
    const message = CompletionSchema.parse(await res.json()).choices[0]?.message;
    if (!message?.content) {
      throw new Error(message?.refusal ? 'OpenAI refused the request' : 'OpenAI returned no content');
    }
    return JSON.parse(message.content) as unknown;
  };
}
