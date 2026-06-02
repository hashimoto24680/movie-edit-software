import { serializeProject } from "./serializer";
import type { Clip, ProjectAst, Track } from "./types";

export interface ProjectDiff {
  summary: string[];
  beforeJson: string;
  afterJson: string;
}

const clipMap = (project: ProjectAst): Map<string, { track: Track; clip: Clip }> => {
  const map = new Map<string, { track: Track; clip: Clip }>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      map.set(clip.id, { track, clip });
    }
  }
  return map;
};

export const diffProjects = (before: ProjectAst, after: ProjectAst): ProjectDiff => {
  const summary: string[] = [];
  const beforeClips = clipMap(before);
  const afterClips = clipMap(after);

  for (const [id, { clip, track }] of afterClips) {
    const previous = beforeClips.get(id);
    if (!previous) {
      summary.push(`Added ${clip.type} clip "${clip.name}" to ${track.name}.`);
      continue;
    }

    if (previous.track.id !== track.id) {
      summary.push(`Moved clip "${clip.name}" from ${previous.track.name} to ${track.name}.`);
    }
    if (previous.clip.startFrame !== clip.startFrame || previous.clip.durationFrames !== clip.durationFrames) {
      summary.push(`Retimed clip "${clip.name}".`);
    }
    if ("text" in clip && "text" in previous.clip && previous.clip.text !== clip.text) {
      summary.push(`Updated text on "${clip.name}".`);
    }
    if (
      "transform" in clip &&
      "transform" in previous.clip &&
      JSON.stringify(previous.clip.transform) !== JSON.stringify(clip.transform)
    ) {
      summary.push(`Updated transform on "${clip.name}".`);
    }
    if (clip.type === "media" && previous.clip.type === "media") {
      const previousVolume =
        previous.clip.audio.volume.mode === "static" ? previous.clip.audio.volume.value : "keyframed";
      const nextVolume = clip.audio.volume.mode === "static" ? clip.audio.volume.value : "keyframed";
      if (previousVolume !== nextVolume) {
        summary.push(`Changed volume on "${clip.name}".`);
      }
    }
  }

  for (const [id, { clip }] of beforeClips) {
    if (!afterClips.has(id)) {
      summary.push(`Removed ${clip.type} clip "${clip.name}".`);
    }
  }

  if (before.tracks.length !== after.tracks.length) {
    summary.push(`Track count changed from ${before.tracks.length} to ${after.tracks.length}.`);
  }

  return {
    summary: summary.length > 0 ? summary : ["No visible timeline changes."],
    beforeJson: serializeProject(before),
    afterJson: serializeProject(after)
  };
};
