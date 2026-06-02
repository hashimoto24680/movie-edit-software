import type { ProjectAst } from "./types";

export const timelineBoundaryFrames = (project: ProjectAst, excludedClipId?: string): number[] =>
  [
    0,
    ...project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) =>
        clip.id === excludedClipId ? [] : [clip.startFrame, clip.startFrame + clip.durationFrames]
      )
    ),
    ...project.markers.map((marker) => marker.frame)
  ]
    .filter((frame, index, frames) => frames.indexOf(frame) === index)
    .sort((a, b) => a - b);

export const nearestTimelineBoundary = (
  project: ProjectAst,
  currentFrame: number,
  direction: "previous" | "next"
): number | null => {
  const boundaries = timelineBoundaryFrames(project);
  if (direction === "previous") {
    return [...boundaries].reverse().find((frame) => frame < currentFrame) ?? null;
  }
  return boundaries.find((frame) => frame > currentFrame) ?? null;
};
