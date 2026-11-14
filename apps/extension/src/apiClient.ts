import type {
  ApiResult,
  CreateVideoRequest,
  CreateVideoResponse,
  VideoStatusResponse,
} from '@outside/shared';

export interface ApiClient {
  createVideo(body: CreateVideoRequest): Promise<ApiResult<CreateVideoResponse>>;
  getVideo(videoId: string): Promise<ApiResult<VideoStatusResponse>>;
  health(): Promise<ApiResult<{ status: string }>>;
}

const TIMEOUT_MS = 10_000;

/** What every failure to talk to the server becomes. The badge hides on it. */
export const UNREACHABLE: ApiResult<never> = { success: false, data: null, error: 'unreachable' };

export function isEnvelope(value: unknown): value is ApiResult<unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.success === true) {
    return envelope.data !== null && envelope.data !== undefined;
  }
  return envelope.success === false && typeof envelope.error === 'string';
}

/**
 * Talks to the local server. It never throws: a network error, a timeout or a reply that is not
 * our envelope all come back as the `unreachable` result.
 */
export function createApiClient(fetchFn: typeof fetch, serverUrl: () => Promise<string>): ApiClient {
  const call = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
    try {
      const base = (await serverUrl()).replace(/\/+$/, '');
      const res = await fetchFn(`${base}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body: unknown = await res.json();
      return isEnvelope(body) ? (body as ApiResult<T>) : UNREACHABLE;
    } catch {
      // Unreachable is an expected state (server not started); the caller decides what to show.
      return UNREACHABLE;
    }
  };

  return {
    createVideo: (body) =>
      call('/api/videos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    getVideo: (videoId) => call(`/api/videos/${encodeURIComponent(videoId)}`),
    health: () => call('/api/health'),
  };
}
