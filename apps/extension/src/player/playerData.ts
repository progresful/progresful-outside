import { VideoManifestSchema, type VideoManifest } from '@outside/shared';
import { isEnvelope } from '../apiClient';

export interface PlayerParams {
  videoId: string | null;
  /** `?sample=1` plays the bundled sample manifest: a way to see the player with no server. */
  sample: boolean;
}

const VIDEO_ID = /^[0-9a-f]{16}$/;

export function playerParams(search: string): PlayerParams {
  const params = new URLSearchParams(search);
  const videoId = params.get('videoId') ?? '';
  return { videoId: VIDEO_ID.test(videoId) ? videoId : null, sample: params.get('sample') === '1' };
}

/** The manifest from the server's status reply, or null unless the video is ready and well-formed. */
export function manifestFrom(reply: unknown): VideoManifest | null {
  if (!isEnvelope(reply) || !reply.success) {
    return null;
  }
  const parsed = VideoManifestSchema.safeParse((reply.data as { manifest?: unknown }).manifest);
  return parsed.success ? parsed.data : null;
}
