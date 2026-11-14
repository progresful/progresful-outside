import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { fail } from '../envelope';
import { MEDIA_ROUTE, isSafeMediaName } from '../media/mediaStore';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};

/** Serves voice tracks and mirrored images. Only plain file names inside the media folder are reachable. */
export function mediaRoutes(mediaDir: string): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { file: string } }>(`${MEDIA_ROUTE}/:file`, async (request, reply) => {
      const { file } = request.params;
      if (!isSafeMediaName(file)) {
        return reply.code(404).send(fail('Not found'));
      }
      try {
        const data = await readFile(join(mediaDir, file));
        return await reply.type(CONTENT_TYPES[extname(file)] ?? 'application/octet-stream').send(data);
      } catch {
        // A missing or unreadable file is simply not there as far as the client is concerned.
        return reply.code(404).send(fail('Not found'));
      }
    });
  };
}
