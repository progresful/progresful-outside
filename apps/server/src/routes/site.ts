import { extname, resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

/** How long a browser may keep a stylesheet, script, font or picture before asking again. */
const ASSET_MAX_AGE_SECONDS = 3600;

/** The page and the download change with every release, so they are checked on every visit. */
const ALWAYS_FRESH: ReadonlySet<string> = new Set(['.html', '.zip', '.json']);

/** Everything the page shows is served from here; nothing else may load, and nobody may frame it. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Serves the landing page and the extension download from one folder. Hidden files are not
 * served, and a path that leaves the folder is answered like any other unknown address.
 */
export function siteRoutes(siteDir: string): FastifyPluginAsync {
  return async (app) => {
    await app.register(fastifyStatic, {
      root: resolve(siteDir),
      dotfiles: 'ignore',
      cacheControl: false,
      setHeaders: (res, path) => {
        const fresh = ALWAYS_FRESH.has(extname(path).toLowerCase());
        res.header('Cache-Control', fresh ? 'no-cache' : `public, max-age=${ASSET_MAX_AGE_SECONDS}`);
        res.header('X-Content-Type-Options', 'nosniff');
        res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
      },
    });
  };
}
