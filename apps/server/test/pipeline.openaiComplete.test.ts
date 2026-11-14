import { describe, expect, it, vi } from 'vitest';
import { createOpenAiComplete } from '../src/pipeline/openaiComplete';
import { jsonResponse } from './helpers';

const schema = { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } } };

function completion(content: string | null, refusal: string | null = null): unknown {
  return { choices: [{ message: { content, refusal } }] };
}

describe('createOpenAiComplete', () => {
  it('asks the configured model for strict JSON and returns it parsed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion('{"lines":["a"]}')));
    const complete = createOpenAiComplete({ apiKey: 'sk', model: 'some-model', fetch: fetchMock });

    expect(await complete('system text', 'user text', schema)).toEqual({ lines: ['a'] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'some-model',
      messages: [
        { role: 'system', content: 'system text' },
        { role: 'user', content: 'user text' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'voiceover_lines', strict: true, schema } },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a failed request', jsonResponse({ error: { message: 'bad key' } }, 401)],
    ['a refusal', jsonResponse(completion(null, 'I cannot help with that'))],
    ['no content', jsonResponse({ choices: [] })],
    ['content that is not JSON', jsonResponse(completion('not json'))],
  ])('throws on %s', async (_name, response) => {
    const complete = createOpenAiComplete({ apiKey: 'sk', model: 'm', fetch: vi.fn().mockResolvedValue(response) });

    await expect(complete('s', 'u', schema)).rejects.toThrow();
  });

  it('does not put the response body of a failed request in the error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'key sk-secret is invalid' } }, 401));
    const complete = createOpenAiComplete({ apiKey: 'sk', model: 'm', fetch: fetchMock });

    await expect(complete('s', 'u', schema)).rejects.toThrow(/^OpenAI responded with status 401$/);
  });
});
