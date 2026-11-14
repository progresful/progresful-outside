import { z } from 'zod';
import { OpeningHoursSchema, SourceSchema } from './facts';
import { INTEREST_IDS } from './interests';

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const MIN_FRAMES = 300;
export const MAX_FRAMES = 900;

export const SCENE_TYPES = ['hook', 'activity', 'experiences', 'stay', 'outro'] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const CaptionWordSchema = z.object({
  text: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
});
export type CaptionWord = z.infer<typeof CaptionWordSchema>;

export const SceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().min(1),
  imageUrl: z.string().optional(),
  title: z.string(),
  subtitle: z.string().optional(),
  items: z.array(z.object({ title: z.string(), detail: z.string() })).optional(),
  captions: z.array(CaptionWordSchema),
  factIds: z.array(z.string()),
  place: z.object({ hours: OpeningHoursSchema, timezone: z.string() }).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const VideoManifestSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  fps: z.literal(VIDEO_FPS),
  width: z.literal(VIDEO_WIDTH),
  height: z.literal(VIDEO_HEIGHT),
  durationInFrames: z.number().int().min(MIN_FRAMES).max(MAX_FRAMES),
  audioUrl: z.string().nullable(),
  scenes: z.array(SceneSchema).min(1),
  sources: z.array(SourceSchema),
  oldestFetchedAt: z.string(),
  listing: z.object({ title: z.string(), locationText: z.string() }),
  interests: z.array(z.enum(INTEREST_IDS)),
});
export type VideoManifest = z.infer<typeof VideoManifestSchema>;
