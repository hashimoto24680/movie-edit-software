import { defaultAudio, defaultRenderSettings, defaultTransform } from "./defaults";
import { projectAstSchema } from "./schema";
import {
  CURRENT_SCHEMA_VERSION,
  type AudioProperties,
  type Clip,
  type ProjectAst,
  type Track,
  type TransformProperties
} from "./types";

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizeClip = (raw: Record<string, unknown>): Clip => {
  const type = String(raw.type ?? "media");
  const base = {
    id: String(raw.id ?? crypto.randomUUID()),
    name: String(raw.name ?? raw.id ?? "clip"),
    startFrame: Number(raw.startFrame ?? raw.atFrame ?? 0),
    durationFrames: Number(raw.durationFrames ?? 30),
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    meta: ensureRecord(raw.meta)
  };

  if (type === "caption") {
    return {
      ...base,
      type: "caption",
      text: String(raw.text ?? ""),
      styleId: String(raw.styleId ?? "caption-bottom"),
      transform: (raw.transform as TransformProperties) ?? defaultTransform()
    };
  }

  if (type === "title") {
    return {
      ...base,
      type: "title",
      text: String(raw.text ?? ""),
      styleId: String(raw.styleId ?? "title-center"),
      transform: (raw.transform as TransformProperties) ?? defaultTransform()
    };
  }

  if (type === "composition") {
    return {
      ...base,
      type: "composition",
      compositionId: String(raw.compositionId ?? ""),
      transform: (raw.transform as TransformProperties) ?? defaultTransform()
    };
  }

  return {
    ...base,
    type: "media",
    assetId: String(raw.assetId ?? ""),
    sourceInFrame: Number(raw.sourceInFrame ?? 0),
    sourceDurationFrames: Number(raw.sourceDurationFrames ?? raw.durationFrames ?? 30),
    transform: (raw.transform as TransformProperties) ?? defaultTransform(),
    audio: (raw.audio as AudioProperties) ?? defaultAudio()
  };
};

const normalizeTrack = (raw: Record<string, unknown>): Track => ({
  id: String(raw.id ?? crypto.randomUUID()),
  kind: (raw.kind as Track["kind"]) ?? "video",
  name: String(raw.name ?? raw.id ?? "Track"),
  clips: Array.isArray(raw.clips)
    ? raw.clips.map((clip) => normalizeClip(ensureRecord(clip)))
    : [],
  effects: Array.isArray(raw.effects) ? raw.effects : [],
  locked: Boolean(raw.locked ?? false),
  muted: Boolean(raw.muted ?? false),
  solo: Boolean(raw.solo ?? false),
  meta: ensureRecord(raw.meta)
});

export const migrateProject = (input: unknown): ProjectAst => {
  const raw = ensureRecord(input);
  const schemaVersion = raw.schemaVersion ?? raw.schema_version;

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    return projectAstSchema.parse(raw);
  }

  if (schemaVersion === undefined || schemaVersion === 0) {
    const migrated = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: String(raw.id ?? "project-untitled"),
      name: String(raw.name ?? "Untitled Project"),
      render: raw.render ?? defaultRenderSettings(),
      assets: Array.isArray(raw.assets)
        ? raw.assets.map((asset) => ({
            id: String(ensureRecord(asset).id ?? crypto.randomUUID()),
            kind: ensureRecord(asset).kind ?? "video",
            name: String(ensureRecord(asset).name ?? ensureRecord(asset).id ?? "asset"),
            path: String(ensureRecord(asset).path ?? ensureRecord(asset).name ?? ""),
            durationFrames: ensureRecord(asset).durationFrames,
            width: ensureRecord(asset).width,
            height: ensureRecord(asset).height,
            sampleRate: ensureRecord(asset).sampleRate,
            meta: ensureRecord(ensureRecord(asset).meta)
          }))
        : [],
      tracks: Array.isArray(raw.tracks) ? raw.tracks.map((track) => normalizeTrack(ensureRecord(track))) : [],
      compositions: Array.isArray(raw.compositions) ? raw.compositions : [],
      markers: Array.isArray(raw.markers)
        ? raw.markers.map((marker) => {
            const record = ensureRecord(marker);
            return {
              id: String(record.id ?? crypto.randomUUID()),
              frame: Number(record.frame ?? record.startFrame ?? 0),
              label: String(record.label ?? "Marker"),
              color: String(record.color ?? "#f3d77c"),
              meta: ensureRecord(record.meta)
            };
          })
        : [],
      meta: ensureRecord(raw.meta)
    };

    return projectAstSchema.parse(migrated);
  }

  throw new Error(`Unsupported project schema version: ${String(schemaVersion)}`);
};
