import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig(process.env);
const app = buildApp({ logger: true });

// Local only: the extension's background worker is the sole client.
app.listen({ port: config.port, host: '127.0.0.1' }).catch((error: unknown) => {
  app.log.error({ err: error }, 'server failed to start');
  process.exit(1);
});
