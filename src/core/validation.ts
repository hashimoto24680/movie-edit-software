import { projectAstSchema } from "./schema";
import type { Asset, Clip, EffectNode, ProjectAst, Track } from "./types";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const supportedEffectTypes = new Set([
  "transform",
  "opacity",
  "volume",
  "blur",
  "color-correction",
  "caption-style",
  "title-style"
]);

export const allClips = (project: ProjectAst): Array<{ track: Track; clip: Clip }> =>
  project.tracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })));

export const findAsset = (project: ProjectAst, assetId: string): Asset | undefined =>
  project.assets.find((asset) => asset.id === assetId);

export const findClip = (
  project: ProjectAst,
  clipId: string
): { track: Track; clip: Clip; clipIndex: number; trackIndex: number } | undefined => {
  for (const [trackIndex, track] of project.tracks.entries()) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex >= 0) {
      return { track, clip: track.clips[clipIndex], clipIndex, trackIndex };
    }
  }

  return undefined;
};

const collectEffectWarnings = (effects: EffectNode[], ownerId: string, warnings: string[]) => {
  for (const effect of effects) {
    if (!supportedEffectTypes.has(effect.type)) {
      warnings.push(`Unsupported effect "${effect.type}" on ${ownerId} will be preserved but not rendered yet.`);
    }
  }
};

export const validateProject = (project: unknown): ValidationResult => {
  const parsed = projectAstSchema.safeParse(project);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      warnings: []
    };
  }

  const ast = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  const addId = (id: string, label: string) => {
    if (ids.has(id)) {
      errors.push(`Duplicate id "${id}" found at ${label}.`);
    }
    ids.add(id);
  };

  for (const asset of ast.assets) {
    addId(asset.id, `asset ${asset.name}`);
  }

  for (const track of ast.tracks) {
    addId(track.id, `track ${track.name}`);
    collectEffectWarnings(track.effects, track.id, warnings);

    for (const clip of track.clips) {
      addId(clip.id, `clip ${clip.name}`);
      collectEffectWarnings(clip.effects, clip.id, warnings);

      if (clip.type === "caption" && clip.text.trim().length === 0) {
        errors.push(`Caption clip "${clip.id}" has empty text.`);
      }

      if (clip.type === "media") {
        const asset = findAsset(ast, clip.assetId);
        if (!asset) {
          errors.push(`Media clip "${clip.id}" references missing asset "${clip.assetId}".`);
        } else {
          if (
            asset.durationFrames !== undefined &&
            clip.sourceInFrame + clip.sourceDurationFrames > asset.durationFrames
          ) {
            errors.push(`Media clip "${clip.id}" exceeds source asset duration.`);
          }
        }
      }

      if (
        clip.type === "composition" &&
        !ast.compositions.some((composition) => composition.id === clip.compositionId)
      ) {
        errors.push(`Composition clip "${clip.id}" references missing composition "${clip.compositionId}".`);
      }
    }

    const sortedClips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < sortedClips.length; index += 1) {
      const previous = sortedClips[index - 1];
      const current = sortedClips[index];
      const previousEnd = previous.startFrame + previous.durationFrames;
      if (current.startFrame < previousEnd) {
        errors.push(
          `Layer "${track.name}" has overlapping objects "${previous.name}" and "${current.name}".`
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
};
