import type { FastifyPluginAsync } from 'fastify';
import { ok } from '../envelope';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async () => ok({ status: 'ok' }));
};
