import { z } from "zod";
import { CURRENT_SCHEMA_VERSION } from "./types";

const easingSchema = z.enum(["linear", "easeIn", "easeOut", "easeInOut", "hold"]);
const effectNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()),
  meta: z.record(z.string(), z.unknown())
});

const animatedNumberSchema = z.union([
  z.object({ mode: z.literal("static"), value: z.number().finite() }),
  z.object({
    mode: z.literal("keyframed"),
    keyframes: z
      .array(
        z.object({
          id: z.string().optional(),
          frame: z.number().int().nonnegative(),
          value: z.number().finite(),
          easing: easingSchema
        })
      )
      .min(1)
  })
]);

const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

const animatedPointSchema = z.union([
  z.object({ mode: z.literal("static"), value: pointSchema }),
  z.object({
    mode: z.literal("keyframed"),
    keyframes: z
      .array(
        z.object({
          id: z.string().optional(),
          frame: z.number().int().nonnegative(),
          value: pointSchema,
          easing: easingSchema
        })
      )
      .min(1)
  })
]);

const transformSchema = z.object({
  opacity: animatedNumberSchema,
  position: animatedPointSchema,
  scale: animatedPointSchema,
  rotation: animatedNumberSchema,
  anchor: animatedPointSchema
});

const audioSchema = z.object({
  volume: animatedNumberSchema,
  pan: animatedNumberSchema
});

const clipBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  effects: z.array(effectNodeSchema),
  meta: z.record(z.string(), z.unknown())
});

const mediaClipSchema = clipBaseSchema.extend({
  type: z.literal("media"),
  assetId: z.string().min(1),
  sourceInFrame: z.number().int().nonnegative(),
  sourceDurationFrames: z.number().int().positive(),
  transform: transformSchema,
  audio: audioSchema
});

const captionClipSchema = clipBaseSchema.extend({
  type: z.literal("caption"),
  text: z.string(),
  styleId: z.string().min(1),
  transform: transformSchema
});

const titleClipSchema = clipBaseSchema.extend({
  type: z.literal("title"),
  text: z.string(),
  styleId: z.string().min(1),
  transform: transformSchema
});

const compositionClipSchema = clipBaseSchema.extend({
  type: z.literal("composition"),
  compositionId: z.string().min(1),
  transform: transformSchema
});

export const clipSchema = z.discriminatedUnion("type", [
  mediaClipSchema,
  captionClipSchema,
  titleClipSchema,
  compositionClipSchema
]);

export const assetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio", "image"]),
  name: z.string().min(1),
  path: z.string().min(1),
  durationFrames: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sampleRate: z.number().int().positive().optional(),
  meta: z.record(z.string(), z.unknown())
});

export const trackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["layer", "video", "audio", "caption", "overlay", "adjustment"]),
  name: z.string().min(1),
  clips: z.array(clipSchema),
  effects: z.array(effectNodeSchema),
  locked: z.boolean(),
  muted: z.boolean(),
  solo: z.boolean(),
  meta: z.record(z.string(), z.unknown())
});

export const compositionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationFrames: z.number().int().positive(),
  tracks: z.array(trackSchema),
  effects: z.array(effectNodeSchema),
  meta: z.record(z.string(), z.unknown())
});

export const renderSettingsSchema = z.object({
  size: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  fps: z.object({
    num: z.number().int().positive(),
    den: z.number().int().positive()
  }),
  format: z.literal("mp4"),
  videoCodec: z.enum(["h264", "h265", "prores"]),
  audioCodec: z.enum(["aac", "pcm"]),
  background: z.string().min(1)
});

export const projectAstSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  render: renderSettingsSchema,
  assets: z.array(assetSchema),
  tracks: z.array(trackSchema),
  compositions: z.array(compositionSchema),
  meta: z.record(z.string(), z.unknown())
});

export const projectCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("importAsset"), asset: assetSchema }),
  z.object({ type: z.literal("addTrack"), track: trackSchema }),
  z.object({
    type: z.literal("updateTrackState"),
    trackId: z.string().min(1),
    locked: z.boolean().optional(),
    muted: z.boolean().optional(),
    solo: z.boolean().optional()
  }),
  z.object({ type: z.literal("addClip"), trackId: z.string().min(1), clip: clipSchema }),
  z.object({
    type: z.literal("trimClip"),
    clipId: z.string().min(1),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional(),
    sourceInFrame: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal("moveClip"),
    clipId: z.string().min(1),
    targetTrackId: z.string().min(1).optional(),
    startFrame: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("splitClip"),
    clipId: z.string().min(1),
    atFrame: z.number().int().nonnegative(),
    newClipId: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("updateCaption"),
    clipId: z.string().min(1),
    text: z.string().optional(),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional()
  }),
  z.object({
    type: z.literal("updateText"),
    clipId: z.string().min(1),
    text: z.string().optional(),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional()
  }),
  z.object({ type: z.literal("removeClip"), clipId: z.string().min(1) }),
  z.object({ type: z.literal("rippleRemoveClip"), clipId: z.string().min(1) }),
  z.object({
    type: z.literal("setVolume"),
    clipId: z.string().min(1),
    volume: z.number().min(0).max(2)
  }),
  z.object({ type: z.literal("addTitle"), trackId: z.string().min(1), clip: titleClipSchema }),
  z.object({ type: z.literal("updateRenderSettings"), render: renderSettingsSchema.partial() }),
  z.object({
    type: z.literal("updateClipTransform"),
    clipId: z.string().min(1),
    position: pointSchema.optional(),
    scale: pointSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotation: z.number().finite().optional(),
    anchor: pointSchema.optional()
  }),
  z.object({
    type: z.literal("updateClipMeta"),
    clipId: z.string().min(1),
    meta: z.record(z.string(), z.unknown())
  }),
  z.object({ type: z.literal("addEffect"), targetId: z.string().min(1), effect: effectNodeSchema })
]);

export type ProjectAstFromSchema = z.infer<typeof projectAstSchema>;
