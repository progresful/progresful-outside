import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoManifest } from '@outside/shared';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createSqliteCacheStore } from '../src/cache/cacheStore';
import { createJobStore } from '../src/jobs/jobStore';
import { NotEnoughDataError, type StageUpdate } from '../src/pipeline/run';
import type { RunVideo } from '../src/routes/videos';
import { NOW } from './helpers';
import { listing } from './fixtures/pipelineDeps';

const manifest: VideoManifest = {
  id: 'placeholder',
  version: 1,
  fps: 30,
  width: 1280,
  height: 720,
  durationInFrames: 300,
  audioUrl: null,
  scenes: [{ type: 'hook', startFrame: 0, durationInFrames: 300, title: 'Around Lisbon', captions: [], factIds: [] }],
  sources: [{ id: 's', label: 'Google Maps', url: 'https://maps.google.com', fetchedAt: '2026-11-14T02:14:00.000Z' }],
  oldestFetchedAt: '2026-11-14T02:14:00.000Z',
  listing: { title: 'Flat with a view', locationText: 'Lisbon, Portugal' },
  interests: ['food'],
};

interface Harness {
  app: FastifyInstance;
  run: ReturnType<typeof vi.fn<RunVideo>>;
  finish(result?: VideoManifest): void;
  fail(error: Error): void;
  stage(update: StageUpdate): void;
}

/** An app whose pipeline is a promise the test settles by hand. */
function harness(): Harness {
  let resolve: (value: VideoManifest) => void = () => {};
  let reject: (error: Error) => void = () => {};
  let onStage: (update: StageUpdate) => void = () => {};
  const run = vi.fn<RunVideo>((_input, report) => {
    onStage = report;
    return new Promise<VideoManifest>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  const app = buildApp({
    videos: { cache: createSqliteCacheStore(':memory:'), jobs: createJobStore(), run, now: () => NOW },
  });
  return { app, run, finish: (result = manifest) => resolve(result), fail: (error) => reject(error), stage: (u) => onStage(u) };
}

async function post(app: FastifyInstance, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/videos', payload: body as object });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const body = { listing, interests: ['food', 'culture'] };

describe('POST /api/videos', () => {
  it('starts a job and returns its id', async () => {
    const { app, run } = harness();

    const res = await post(app, body);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      data: { videoId: expect.stringMatching(/^[0-9a-f]{16}$/), status: 'queued', cached: false },
      error: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toMatchObject({ listing, interests: ['food', 'culture'] });
  });

  it('runs one pipeline for concurrent requests for the same video', async () => {
    const { app, run } = harness();

    const [first, second] = await Promise.all([post(app, body), post(app, body)]);

    expect(first.json().data.videoId).toBe(second.json().data.videoId);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports cached: true once the video is ready', async () => {
    const { app, run, finish } = harness();
    await post(app, body);
    finish();
    await settle();

    const res = await post(app, body);

    expect(res.json().data).toMatchObject({ status: 'ready', cached: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('gives different interests and dates their own video', async () => {
    const { app } = harness();
    const ids = await Promise.all([
      post(app, body),
      post(app, { ...body, interests: ['food'] }),
      post(app, { listing: { ...listing, checkIn: '2027-01-02', checkOut: '2027-01-05' }, interests: body.interests }),
    ]);

    expect(new Set(ids.map((res) => res.json().data.videoId)).size).toBe(3);
  });

  it('treats no interests as the default set', async () => {
    const { app, run } = harness();

    const none = await post(app, { listing, interests: [] });
    const defaults = await post(app, { listing, interests: ['nature', 'food', 'culture'] });

    expect(none.json().data.videoId).toBe(defaults.json().data.videoId);
    expect(run.mock.calls[0]?.[0].interests).toEqual(['food', 'culture', 'nature']);
  });

  it.each([
    ['6 interests', { listing, interests: ['food', 'water', 'gems', 'events', 'family', 'nature'] }],
    ['an unknown site', { listing: { ...listing, site: 'vrbo' }, interests: [] }],
    ['no listing', { interests: [] }],
  ])('rejects %s with a 400 envelope', async (_name, bad) => {
    const { app, run } = harness();

    const res = await post(app, bad);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ success: false, data: null, error: 'Invalid request' });
    expect(run).not.toHaveBeenCalled();
  });

  it('starts again after a failed job', async () => {
    const { app, run, fail } = harness();
    await post(app, body);
    fail(new Error('boom'));
    await settle();

    await post(app, body);

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/videos/:id', () => {
  it('reports the live stage, then the manifest', async () => {
    const { app, stage, finish } = harness();
    const { videoId } = (await post(app, body)).json().data;

    stage({ status: 'gathering', stage: 'Checking live prices', progress: 0.6 });
    const during = await app.inject({ method: 'GET', url: `/api/videos/${videoId}` });
    expect(during.json().data).toEqual({ status: 'gathering', stage: 'Checking live prices', progress: 0.6 });

    finish({ ...manifest, id: videoId });
    await settle();
    const after = await app.inject({ method: 'GET', url: `/api/videos/${videoId}` });
    expect(after.json().data).toMatchObject({ status: 'ready', progress: 1, manifest: { id: videoId } });
  });

  it('keeps a failed job failed when a late stage update arrives', async () => {
    const h = harness();
    const { videoId } = (await post(h.app, { listing, interests: [] })).json().data;
    h.fail(new Error('boom'));
    await settle();

    // Other sources are still finishing and report their stage after the job has failed.
    h.stage({ status: 'gathering', stage: 'Checking live prices', progress: 0.6 });

    const res = await h.app.inject({ method: 'GET', url: `/api/videos/${videoId}` });
    expect(res.json().data).toMatchObject({ status: 'failed', stage: 'Failed' });
  });

  it('gives the same listing id its own video when the page describes another place', async () => {
    const h = harness();
    const first = (await post(h.app, { listing, interests: [] })).json().data.videoId;
    const elsewhere = { ...listing, locationText: 'Porto, Portugal', lat: 41.15, lng: -8.61 };

    const second = (await post(h.app, { listing: elsewhere, interests: [] })).json().data.videoId;

    expect(second).not.toBe(first);
    expect(h.run).toHaveBeenCalledTimes(2);
  });

  it('tells the user when the area has too little data', async () => {
    const { app, fail } = harness();
    const { videoId } = (await post(app, body)).json().data;
    fail(new NotEnoughDataError());
    await settle();

    const res = await app.inject({ method: 'GET', url: `/api/videos/${videoId}` });

    expect(res.json().data).toMatchObject({ status: 'failed', error: 'Not enough live data for this area' });
  });

  it('hides the details of any other failure', async () => {
    const { app, fail } = harness();
    const { videoId } = (await post(app, body)).json().data;
    fail(new Error('OPENAI_API_KEY sk-secret rejected'));
    await settle();

    const res = await app.inject({ method: 'GET', url: `/api/videos/${videoId}` });

    expect(res.json().data).toMatchObject({ status: 'failed', error: 'Could not build the video' });
  });

  it('no longer has a video that an older version of the video template made', async () => {
    const cache = createSqliteCacheStore(':memory:');
    // How videos were stored before the template version became part of the key.
    cache.set('video:0123456789abcdef', manifest, { fetchedAt: NOW });
    const app = buildApp({ videos: { cache, jobs: createJobStore(), run: vi.fn<RunVideo>(), now: () => NOW } });

    const res = await app.inject({ method: 'GET', url: '/api/videos/0123456789abcdef' });

    // A tab still offering that video is told it is gone, and builds the current one instead.
    expect(res.statusCode).toBe(404);
  });

  it.each(['0123456789abcdef', 'not-an-id', '..%2F..%2Fetc'])('answers 404 for %s', async (id) => {
    const res = await harness().app.inject({ method: 'GET', url: `/api/videos/${id}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, data: null, error: 'Not found' });
  });
});

describe('GET /media/:file', () => {
  function mediaApp(): FastifyInstance {
    const dir = mkdtempSync(join(tmpdir(), 'outside-media-'));
    writeFileSync(join(dir, 'abc.mp3'), 'audio');
    writeFileSync(join(dir, 'pic.jpg'), 'image');
    return buildApp({ mediaDir: dir });
  }

  it('serves a stored file with its content type', async () => {
    const app = mediaApp();

    const audio = await app.inject({ method: 'GET', url: '/media/abc.mp3' });
    const image = await app.inject({ method: 'GET', url: '/media/pic.jpg' });

    expect([audio.statusCode, audio.headers['content-type'], audio.body]).toEqual([200, 'audio/mpeg', 'audio']);
    expect(image.headers['content-type']).toBe('image/jpeg');
  });

  it.each(['missing.mp3', '..%2Fsecret.txt', '.env'])('answers 404 for %s', async (name) => {
    const res = await mediaApp().inject({ method: 'GET', url: `/media/${name}` });

    expect(res.statusCode).toBe(404);
  });
});
