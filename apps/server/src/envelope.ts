import type { ApiResult } from '@outside/shared';

export function ok<T>(data: T): ApiResult<T> {
  return { success: true, data, error: null };
}

export function fail(error: string): ApiResult<never> {
  return { success: false, data: null, error };
}
