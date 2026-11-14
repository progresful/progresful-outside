import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entry]) => `${JSON.stringify(name)}:${stableStringify(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A recorded response is addressed by the API path and the exact request body. */
export function fixtureName(path: string, body: unknown): string {
  const hash = createHash('sha256').update(`${path}\n${stableStringify(body)}`).digest('hex');
  return `${hash}.json`;
}

export function readFixture(dir: string, path: string, body: unknown): unknown {
  const file = join(dir, fixtureName(path, body));
  if (!existsSync(file)) {
    throw new Error(`No recorded fixture for ${path} (${file})`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

export function writeFixture(dir: string, path: string, body: unknown, response: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fixtureName(path, body)), JSON.stringify(response, null, 2));
}
