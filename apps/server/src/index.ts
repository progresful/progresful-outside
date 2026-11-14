import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createRuntime } from './wiring';

const config = loadConfig(process.env);

// The runtime is built before the app, so skipped-source failures reach the app's logger lazily.
const runtime = createRuntime(config, (sourceId, error) => {
  app.log.warn({ err: error, sourceId }, 'source skipped');
});
const app: FastifyInstance = buildApp(runtime.appDeps);

runtime.startSweeper((error) => app.log.error({ err: error }, 'sweep failed'));

// Local only: the extension's background worker is the sole client.
app.listen({ port: config.port, host: '127.0.0.1' }).catch((error: unknown) => {
  app.log.error({ err: error }, 'server failed to start');
  process.exit(1);
});
