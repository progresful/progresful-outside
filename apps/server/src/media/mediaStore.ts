import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TTL_MS } from '../cache/cacheStore';

export const MEDIA_ROUTE = '/media';

export interface MediaStore {
  /** Stores the file and returns the path the player loads it from, e.g. `/media/abc.mp3`. */
  put(name: string, data: Buffer): Promise<string>;
  /** Deletes files older than the cache TTL and returns how many were removed. */
  sweep(now?: number): Promise<number>;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A plain file name: no path separators, no leading dot. */
export function isSafeMediaName(name: string): boolean {
  return SAFE_NAME.test(name);
}

export function createDiskMediaStore(dir: string): MediaStore {
  return {
    async put(name: string, data: Buffer): Promise<string> {
      if (!isSafeMediaName(name)) {
        throw new Error(`Unsafe media name: ${JSON.stringify(name)}`);
      }
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), data);
      return `${MEDIA_ROUTE}/${name}`;
    },
    async sweep(now: number = Date.now()): Promise<number> {
      const names = await readdir(dir).catch(() => [] as string[]);
      const removed = await Promise.all(
        names.map(async (name) => {
          const file = join(dir, name);
          const info = await stat(file);
          if (!info.isFile() || now - info.mtimeMs <= TTL_MS) {
            return 0;
          }
          await unlink(file);
          return 1;
        }),
      );
      return removed.reduce<number>((sum, count) => sum + count, 0);
    },
  };
}
