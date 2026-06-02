import type {
  AnimatedNumber,
  AnimatedPoint,
  AudioProperties,
  EffectNode,
  Fps,
  RenderSettings,
  TransformProperties
} from "./types";

export const defaultFps: Fps = { num: 30, den: 1 };

export const staticNumber = (value: number): AnimatedNumber => ({ mode: "static", value });

export const staticPoint = (x: number, y: number): AnimatedPoint => ({
  mode: "static",
  value: { x, y }
});

export const defaultTransform = (): TransformProperties => ({
  opacity: staticNumber(1),
  position: staticPoint(0.5, 0.5),
  scale: staticPoint(1, 1),
  rotation: staticNumber(0),
  anchor: staticPoint(0.5, 0.5)
});

export const defaultAudio = (): AudioProperties => ({
  volume: staticNumber(1),
  pan: staticNumber(0)
});

export const defaultRenderSettings = (): RenderSettings => ({
  size: { width: 1080, height: 1920 },
  fps: defaultFps,
  format: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  background: "#101418"
});

export const emptyEffect = (id: string, type = "transform", name = "Transform"): EffectNode => ({
  id,
  type,
  name,
  enabled: true,
  params: {},
  meta: {}
});
