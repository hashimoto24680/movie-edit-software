export const CURRENT_SCHEMA_VERSION = 1;

export type TrackKind = "layer" | "video" | "audio" | "caption" | "overlay" | "adjustment";
export type AssetKind = "video" | "audio" | "image";
export type ClipType = "media" | "caption" | "title" | "composition";
export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";

export interface Fps {
  num: number;
  den: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Keyframe<T> {
  id?: string;
  frame: number;
  value: T;
  easing: Easing;
}

export type StaticOrKeyframed<T> =
  | { mode: "static"; value: T }
  | { mode: "keyframed"; keyframes: Keyframe<T>[] };

export type AnimatedNumber = StaticOrKeyframed<number>;

export interface Point2D {
  x: number;
  y: number;
}

export type AnimatedPoint = StaticOrKeyframed<Point2D>;

export interface TransformProperties {
  opacity: AnimatedNumber;
  position: AnimatedPoint;
  scale: AnimatedPoint;
  rotation: AnimatedNumber;
  anchor: AnimatedPoint;
}

export interface AudioProperties {
  volume: AnimatedNumber;
  pan: AnimatedNumber;
}

export interface EffectNode {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  path: string;
  durationFrames?: number;
  width?: number;
  height?: number;
  sampleRate?: number;
  meta: Record<string, unknown>;
}

export interface ClipBase {
  id: string;
  type: ClipType;
  name: string;
  startFrame: number;
  durationFrames: number;
  effects: EffectNode[];
  meta: Record<string, unknown>;
}

export interface MediaClip extends ClipBase {
  type: "media";
  assetId: string;
  sourceInFrame: number;
  sourceDurationFrames: number;
  transform: TransformProperties;
  audio: AudioProperties;
}

export interface CaptionClip extends ClipBase {
  type: "caption";
  text: string;
  styleId: string;
  transform: TransformProperties;
}

export interface TitleClip extends ClipBase {
  type: "title";
  text: string;
  styleId: string;
  transform: TransformProperties;
}

export interface CompositionClip extends ClipBase {
  type: "composition";
  compositionId: string;
  transform: TransformProperties;
}

export type Clip = MediaClip | CaptionClip | TitleClip | CompositionClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  effects: EffectNode[];
  locked: boolean;
  muted: boolean;
  solo: boolean;
  meta: Record<string, unknown>;
}

export interface Composition {
  id: string;
  name: string;
  durationFrames: number;
  tracks: Track[];
  effects: EffectNode[];
  meta: Record<string, unknown>;
}

export interface RenderSettings {
  size: Size;
  fps: Fps;
  format: "mp4";
  videoCodec: "h264" | "h265" | "prores";
  audioCodec: "aac" | "pcm";
  background: string;
}

export interface TimelineMarker {
  id: string;
  frame: number;
  label: string;
  color: string;
  meta: Record<string, unknown>;
}

export interface ProjectAst {
  schemaVersion: number;
  id: string;
  name: string;
  render: RenderSettings;
  assets: Asset[];
  tracks: Track[];
  compositions: Composition[];
  markers: TimelineMarker[];
  meta: Record<string, unknown>;
}

export type ProjectCommand =
  | { type: "importAsset"; asset: Asset }
  | { type: "addTrack"; track: Track }
  | { type: "updateTrackState"; trackId: string; locked?: boolean; muted?: boolean; solo?: boolean }
  | { type: "addClip"; trackId: string; clip: Clip }
  | {
      type: "trimClip";
      clipId: string;
      startFrame?: number;
      durationFrames?: number;
      sourceInFrame?: number;
    }
  | { type: "moveClip"; clipId: string; targetTrackId?: string; startFrame: number }
  | { type: "splitClip"; clipId: string; atFrame: number; newClipId?: string }
  | { type: "updateCaption"; clipId: string; text?: string; startFrame?: number; durationFrames?: number }
  | { type: "updateText"; clipId: string; text?: string; startFrame?: number; durationFrames?: number }
  | { type: "removeClip"; clipId: string }
  | { type: "rippleRemoveClip"; clipId: string }
  | { type: "setVolume"; clipId: string; volume: number }
  | { type: "addTitle"; trackId: string; clip: TitleClip }
  | { type: "updateRenderSettings"; render: Partial<RenderSettings> }
  | { type: "addMarker"; marker: TimelineMarker }
  | { type: "updateMarker"; markerId: string; frame?: number; label?: string; color?: string; meta?: Record<string, unknown> }
  | { type: "removeMarker"; markerId: string }
  | { type: "updateClipMeta"; clipId: string; meta: Record<string, unknown> }
  | {
      type: "updateClipTransform";
      clipId: string;
      position?: Point2D;
      scale?: Point2D;
      opacity?: number;
      rotation?: number;
      anchor?: Point2D;
    }
  | { type: "addEffect"; targetId: string; effect: EffectNode };

export interface ProjectFile {
  fileType: "movie-edit-software.project";
  fileVersion: 1;
  project: ProjectAst;
}

export interface CommandGroup {
  id: string;
  label: string;
  commands: ProjectCommand[];
  source: "gui" | "llm" | "script";
  createdAt: string;
}
