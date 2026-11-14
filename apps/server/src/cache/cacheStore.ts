import Database from 'better-sqlite3';

/** One cache lifetime for everything: scrape results and finished videos alike. */
export const TTL_MS = 21_600_000;

export interface CacheEntry<T> {
  value: T;
  /** When the data was really fetched from the web, in epoch ms. The TTL counts from here. */
  fetchedAt: number;
}

export interface CacheStore {
  get<T>(key: string, now?: number): CacheEntry<T> | null;
  set<T>(key: string, value: T, opts: { fetchedAt: number }): void;
  delete(key: string): void;
  /** Deletes expired rows and returns how many were removed. */
  sweep(now?: number): number;
}

interface CacheRow {
  value: string;
  fetched_at: number;
}

export function createSqliteCacheStore(path: string): CacheStore {
  const db = new Database(path);
  db.exec(
    'CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)',
  );
  const selectRow = db.prepare<[string], CacheRow>('SELECT value, fetched_at FROM cache WHERE key = ?');
  const upsertRow = db.prepare<[string, string, number]>(
    'INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at',
  );
  const deleteRow = db.prepare<[string]>('DELETE FROM cache WHERE key = ?');
  const deleteExpired = db.prepare<[number]>('DELETE FROM cache WHERE fetched_at <= ?');

  return {
    get<T>(key: string, now: number = Date.now()): CacheEntry<T> | null {
      const row = selectRow.get(key);
      if (!row || now >= row.fetched_at + TTL_MS) {
        return null;
      }
      return { value: JSON.parse(row.value) as T, fetchedAt: row.fetched_at };
    },
    set<T>(key: string, value: T, opts: { fetchedAt: number }): void {
      upsertRow.run(key, JSON.stringify(value), opts.fetchedAt);
    },
    delete(key: string): void {
      deleteRow.run(key);
    },
    sweep(now: number = Date.now()): number {
      return deleteExpired.run(now - TTL_MS).changes;
    },
  };
}
