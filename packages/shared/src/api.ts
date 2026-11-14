import { z } from 'zod';
import { INTEREST_IDS, MAX_INTERESTS } from './interests';
import { ListingContextSchema } from './listing';
import type { VideoManifest } from './manifest';

export type ApiResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: string };

/** The error text of the server's 429 reply. A client seeing it should wait and ask again. */
export const RATE_LIMITED_ERROR = 'Too many requests';

export const VIDEO_STATUSES = ['queued', 'gathering', 'writing', 'voicing', 'ready', 'failed'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const CreateVideoRequestSchema = z.object({
  listing: ListingContextSchema,
  interests: z.array(z.enum(INTEREST_IDS)).max(MAX_INTERESTS),
});
export type CreateVideoRequest = z.infer<typeof CreateVideoRequestSchema>;

export interface CreateVideoResponse {
  videoId: string;
  status: VideoStatus;
  cached: boolean;
}

export interface VideoStatusResponse {
  status: VideoStatus;
  stage: string;
  progress: number;
  manifest?: VideoManifest;
  error?: string;
}
