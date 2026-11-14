import { CreateVideoRequestSchema, type ApiResult } from '@outside/shared';
import { z } from 'zod';
import type { ApiClient } from './apiClient';

/** Messages a content script or the popup sends to the background worker, the only network client. */
export const MessageSchema = z.discriminatedUnion('type', [
  CreateVideoRequestSchema.extend({ type: z.literal('video:create') }),
  z.object({ type: z.literal('video:status'), videoId: z.string().regex(/^[0-9a-f]{16}$/) }),
  z.object({ type: z.literal('server:health') }),
]);

export type Message = z.infer<typeof MessageSchema>;

const BAD_MESSAGE: ApiResult<never> = { success: false, data: null, error: 'bad message' };

/** Validates a message and hands it to the API. Anything it does not recognise is refused. */
export async function routeMessage(api: ApiClient, raw: unknown): Promise<ApiResult<unknown>> {
  const parsed = MessageSchema.safeParse(raw);
  if (!parsed.success) {
    return BAD_MESSAGE;
  }
  const message = parsed.data;
  switch (message.type) {
    case 'video:create':
      return api.createVideo({ listing: message.listing, interests: message.interests });
    case 'video:status':
      return api.getVideo(message.videoId);
    case 'server:health':
      return api.health();
  }
}
