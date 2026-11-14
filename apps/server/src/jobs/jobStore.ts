import type { VideoStatusResponse } from '@outside/shared';

export interface Job extends VideoStatusResponse {
  id: string;
  key: string;
}

export interface JobStore {
  get(id: string): Job | undefined;
  getByKey(key: string): Job | undefined;
  put(job: Job): void;
  delete(id: string): void;
}

/** Videos being built right now, and the ones that failed. Finished videos live in the cache instead. */
export function createJobStore(): JobStore {
  const byId = new Map<string, Job>();
  return {
    get: (id) => byId.get(id),
    getByKey: (key) => [...byId.values()].find((job) => job.key === key),
    put: (job) => {
      byId.set(job.id, job);
    },
    delete: (id) => {
      byId.delete(id);
    },
  };
}
