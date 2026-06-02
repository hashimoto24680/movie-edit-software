import { framesToTimecode } from "../time";
import type { Clip, ProjectAst, Track } from "../types";
import type { Renderer, RenderRequest } from "./types";

export interface FfmpegInput {
  assetId: string;
  path: string;
  kind: "video" | "audio" | "image";
}

export interface FfmpegSegment {
  clipId: string;
  trackId: string;
  assetId?: string;
  type: Clip["type"];
  timelineStart: string;
  duration: string;
  sourceIn?: string;
  text?: string;
}

export interface FfmpegManifest {
  projectId: string;
  outputPath: string;
  size: {
    width: number;
    height: number;
  };
  fps: string;
  inputs: FfmpegInput[];
  segments: FfmpegSegment[];
  commandPreview: string;
}

const trackOrder = (track: Track): number => {
  const order: Record<Track["kind"], number> = {
    layer: 0,
    video: 0,
    overlay: 1,
    adjustment: 2,
    caption: 3,
    audio: 4
  };
  return order[track.kind];
};

const collectInputs = (project: ProjectAst): FfmpegInput[] => {
  const inputs = new Map<string, FfmpegInput>();

  for (const asset of project.assets) {
    inputs.set(asset.id, {
      assetId: asset.id,
      path: asset.path,
      kind: asset.kind
    });
  }

  return [...inputs.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
};

const collectSegments = (project: ProjectAst): FfmpegSegment[] =>
  [...project.tracks]
    .sort((a, b) => trackOrder(a) - trackOrder(b) || a.id.localeCompare(b.id))
    .flatMap((track) =>
      [...track.clips]
        .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id))
        .map((clip) => ({
          clipId: clip.id,
          trackId: track.id,
          assetId: clip.type === "media" ? clip.assetId : undefined,
          type: clip.type,
          timelineStart: framesToTimecode(clip.startFrame, project.render.fps),
          duration: framesToTimecode(clip.durationFrames, project.render.fps),
          sourceIn: clip.type === "media" ? framesToTimecode(clip.sourceInFrame, project.render.fps) : undefined,
          text: "text" in clip ? clip.text : undefined
        }))
    );

const collectWarnings = (project: ProjectAst): string[] => {
  const warnings: string[] = [];
  for (const track of project.tracks) {
    for (const effect of track.effects) {
      if (effect.type !== "transform" && effect.enabled) {
        warnings.push(`Track effect "${effect.type}" on ${track.id} is preserved but not emitted by FFmpeg MVP.`);
      }
    }
    for (const clip of track.clips) {
      for (const effect of clip.effects) {
        if (effect.type !== "transform" && effect.enabled) {
          warnings.push(`Clip effect "${effect.type}" on ${clip.id} is preserved but not emitted by FFmpeg MVP.`);
        }
      }
    }
  }
  return warnings;
};

const createCommandPreview = (project: ProjectAst, inputs: FfmpegInput[], outputPath: string): string => {
  const inputArgs = inputs.map((input) => `-i "${input.path}"`).join(" ");
  const size = `${project.render.size.width}x${project.render.size.height}`;
  const fps = `${project.render.fps.num}/${project.render.fps.den}`;
  return `ffmpeg ${inputArgs} -r ${fps} -s ${size} -c:v libx264 -c:a aac "${outputPath}"`;
};

export const ffmpegRenderer: Renderer<FfmpegManifest> = {
  id: "ffmpeg",
  name: "FFmpeg MVP Renderer",
  createManifest(request: RenderRequest) {
    const inputs = collectInputs(request.project);
    const manifest: FfmpegManifest = {
      projectId: request.project.id,
      outputPath: request.outputPath,
      size: request.project.render.size,
      fps: `${request.project.render.fps.num}/${request.project.render.fps.den}`,
      inputs,
      segments: collectSegments(request.project),
      commandPreview: createCommandPreview(request.project, inputs, request.outputPath)
    };

    return {
      rendererId: this.id,
      manifest,
      warnings: collectWarnings(request.project)
    };
  }
};
