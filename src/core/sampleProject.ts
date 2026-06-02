import { defaultAudio, defaultRenderSettings, defaultTransform, staticNumber, staticPoint } from "./defaults";
import { secondsToFrames } from "./time";
import { CURRENT_SCHEMA_VERSION, type CaptionClip, type MediaClip, type ProjectAst, type TitleClip, type Track } from "./types";

const render = defaultRenderSettings();
const frames = (seconds: number): number => secondsToFrames(seconds, render.fps);

const videoClip = (id: string, name: string, start: number, sourceIn: number, duration: number): MediaClip => ({
  id,
  type: "media",
  name,
  assetId: "asset-talk",
  startFrame: frames(start),
  durationFrames: frames(duration),
  sourceInFrame: frames(sourceIn),
  sourceDurationFrames: frames(duration),
  transform: defaultTransform(),
  audio: defaultAudio(),
  effects: [],
  meta: {}
});

const audioClip = (id: string, start: number, duration: number): MediaClip => ({
  id,
  type: "media",
  name: "BGM",
  assetId: "asset-bgm",
  startFrame: frames(start),
  durationFrames: frames(duration),
  sourceInFrame: 0,
  sourceDurationFrames: frames(duration),
  transform: defaultTransform(),
  audio: { ...defaultAudio(), volume: staticNumber(0.2) },
  effects: [],
  meta: {}
});

const captionClip = (id: string, start: number, duration: number, text: string): CaptionClip => ({
  id,
  type: "caption",
  name: text.slice(0, 16),
  startFrame: frames(start),
  durationFrames: frames(duration),
  text,
  styleId: "caption-bottom",
  transform: { ...defaultTransform(), position: staticPoint(0.5, 0.86), scale: staticPoint(0.9, 1) },
  effects: [],
  meta: {}
});

const titleClip = (): TitleClip => ({
  id: "title-hero",
  type: "title",
  name: "Opening title",
  startFrame: 0,
  durationFrames: frames(3),
  text: "MNP Movie Editor",
  styleId: "title-center",
  transform: {
    ...defaultTransform(),
    position: staticPoint(0.5, 0.42),
    scale: staticPoint(0.9, 1),
    opacity: {
      mode: "keyframed",
      keyframes: [
        { frame: 0, value: 0, easing: "easeOut" },
        { frame: frames(0.5), value: 1, easing: "easeOut" },
        { frame: frames(2.5), value: 1, easing: "linear" },
        { frame: frames(3), value: 0, easing: "easeIn" }
      ]
    }
  },
  effects: [],
  meta: { reservedFor: "motion-graphics" }
});

const track = (id: string, kind: Track["kind"], name: string, clips: Track["clips"] = []): Track => ({
  id,
  kind,
  name,
  clips,
  effects: [],
  locked: false,
  muted: false,
  solo: false,
  meta: {}
});

export const sampleProject: ProjectAst = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "sample-short",
  name: "Sample Short Project",
  render,
  assets: [
    {
      id: "asset-talk",
      kind: "video",
      name: "talk.mp4",
      path: "assets/talk.mp4",
      durationFrames: frames(120),
      width: 1920,
      height: 1080,
      meta: {}
    },
    {
      id: "asset-bgm",
      kind: "audio",
      name: "bgm.wav",
      path: "assets/bgm.wav",
      durationFrames: frames(90),
      sampleRate: 48000,
      meta: {}
    }
  ],
  tracks: [
    track("layer-1", "layer", "レイヤー1", [
      videoClip("clip-talk-1", "Talk intro", 0, 12, 8),
      videoClip("clip-talk-2", "Talk detail", 8, 38, 8)
    ]),
    track("layer-2", "layer", "レイヤー2", [titleClip()]),
    track("layer-3", "layer", "レイヤー3", [
      captionClip("cap-1", 1.2, 2.2, "今日は動画編集ソフトの話をします"),
      captionClip("cap-2", 4.6, 2.8, "AIがタイムラインを直接触らない設計です")
    ]),
    track("layer-4", "layer", "レイヤー4", [audioClip("clip-bgm-1", 0, 16)]),
    track("layer-5", "layer", "レイヤー5")
  ],
  compositions: [],
  meta: {
    roadmap: ["multi-track", "keyframes", "effect-nodes", "nested-compositions", "renderer-interface"]
  }
};
