import { z } from "zod";
import { defaultTransform, staticPoint } from "./defaults";
import { timecodeToFrames } from "./time";
import type { CaptionClip, ProjectAst, ProjectCommand, TitleClip, TrackKind } from "./types";

const llmOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_caption"),
    trackId: z.string().optional(),
    at: z.string(),
    duration: z.string(),
    text: z.string().min(1),
    styleId: z.string().optional()
  }),
  z.object({
    type: z.literal("update_caption"),
    clipId: z.string(),
    text: z.string().optional(),
    at: z.string().optional(),
    duration: z.string().optional()
  }),
  z.object({
    type: z.literal("split_caption"),
    clipId: z.string(),
    at: z.string()
  }),
  z.object({
    type: z.literal("trim_clip"),
    clipId: z.string(),
    start: z.string().optional(),
    duration: z.string().optional(),
    sourceIn: z.string().optional()
  }),
  z.object({
    type: z.literal("set_volume"),
    clipId: z.string(),
    volume: z.number().min(0).max(2)
  }),
  z.object({
    type: z.literal("add_title"),
    trackId: z.string().optional(),
    at: z.string(),
    duration: z.string(),
    text: z.string().min(1),
    styleId: z.string().optional()
  })
]);

export const llmResponseSchema = z.object({
  message: z.string(),
  operations: z.array(llmOperationSchema)
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

const nextClipId = (project: ProjectAst, prefix: string): string => {
  const used = new Set(project.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
  let index = used.size + 1;
  while (used.has(`${prefix}-${index}`)) {
    index += 1;
  }
  return `${prefix}-${index}`;
};

const defaultTrackId = (project: ProjectAst, kind: TrackKind): string => {
  const track = project.tracks.find((candidate) => candidate.kind === kind) ?? project.tracks.find((candidate) => candidate.kind === "layer");
  if (!track) {
    throw new Error(`No ${kind} track exists for LLM operation.`);
  }
  return track.id;
};

export const llmResponseToCommands = (response: LlmResponse, project: ProjectAst): ProjectCommand[] =>
  response.operations.map((operation) => {
    switch (operation.type) {
      case "add_caption": {
        const clip: CaptionClip = {
          id: nextClipId(project, "cap"),
          type: "caption",
          name: "LLM caption",
          startFrame: timecodeToFrames(operation.at, project.render.fps),
          durationFrames: timecodeToFrames(operation.duration, project.render.fps),
          text: operation.text,
          styleId: operation.styleId ?? "caption-bottom",
          transform: { ...defaultTransform(), position: staticPoint(0.5, 0.86), scale: staticPoint(0.9, 1) },
          effects: [],
          meta: { source: "llm" }
        };
        return { type: "addClip", trackId: operation.trackId ?? defaultTrackId(project, "caption"), clip };
      }
      case "update_caption":
        return {
          type: "updateCaption",
          clipId: operation.clipId,
          text: operation.text,
          startFrame: operation.at ? timecodeToFrames(operation.at, project.render.fps) : undefined,
          durationFrames: operation.duration ? timecodeToFrames(operation.duration, project.render.fps) : undefined
        };
      case "split_caption":
        return {
          type: "splitClip",
          clipId: operation.clipId,
          atFrame: timecodeToFrames(operation.at, project.render.fps)
        };
      case "trim_clip":
        return {
          type: "trimClip",
          clipId: operation.clipId,
          startFrame: operation.start ? timecodeToFrames(operation.start, project.render.fps) : undefined,
          durationFrames: operation.duration ? timecodeToFrames(operation.duration, project.render.fps) : undefined,
          sourceInFrame: operation.sourceIn ? timecodeToFrames(operation.sourceIn, project.render.fps) : undefined
        };
      case "set_volume":
        return { type: "setVolume", clipId: operation.clipId, volume: operation.volume };
      case "add_title": {
        const clip: TitleClip = {
          id: nextClipId(project, "title"),
          type: "title",
          name: "LLM title",
          startFrame: timecodeToFrames(operation.at, project.render.fps),
          durationFrames: timecodeToFrames(operation.duration, project.render.fps),
          text: operation.text,
          styleId: operation.styleId ?? "title-center",
          transform: { ...defaultTransform(), position: staticPoint(0.5, 0.42), scale: staticPoint(0.9, 1) },
          effects: [],
          meta: { source: "llm" }
        };
        return { type: "addTitle", trackId: operation.trackId ?? defaultTrackId(project, "overlay"), clip };
      }
      default: {
        const exhaustive: never = operation;
        throw new Error(`Unsupported LLM operation: ${JSON.stringify(exhaustive)}`);
      }
    }
  });

export const parseLlmResponseText = (
  text: string,
  project: ProjectAst
): { response: LlmResponse; commands: ProjectCommand[] } => {
  const parsed = llmResponseSchema.parse(JSON.parse(text));
  return {
    response: parsed,
    commands: llmResponseToCommands(parsed, project)
  };
};
