import { staticNumber, staticPoint } from "./defaults";
import { diffProjects } from "./diff";
import { validateProject, findClip } from "./validation";
import type { ProjectDiff } from "./diff";
import type { Clip, ProjectAst, ProjectCommand, Track } from "./types";

const cloneProject = (project: ProjectAst): ProjectAst => structuredClone(project);

const findTrackIndex = (project: ProjectAst, trackId: string): number =>
  project.tracks.findIndex((track) => track.id === trackId);

const assertTrack = (project: ProjectAst, trackId: string): Track => {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    throw new Error(`Track not found: ${trackId}`);
  }
  if (track.locked) {
    throw new Error(`Track is locked: ${trackId}`);
  }
  return track;
};

const replaceClip = (project: ProjectAst, clipId: string, replace: (clip: Clip) => Clip): ProjectAst => {
  const next = cloneProject(project);
  const located = findClip(next, clipId);
  if (!located) {
    throw new Error(`Clip not found: ${clipId}`);
  }
  if (located.track.locked) {
    throw new Error(`Track is locked: ${located.track.id}`);
  }

  next.tracks[located.trackIndex].clips[located.clipIndex] = replace(located.clip);
  return next;
};

const moveClip = (project: ProjectAst, command: Extract<ProjectCommand, { type: "moveClip" }>): ProjectAst => {
  const next = cloneProject(project);
  const located = findClip(next, command.clipId);
  if (!located) {
    throw new Error(`Clip not found: ${command.clipId}`);
  }
  if (located.track.locked) {
    throw new Error(`Track is locked: ${located.track.id}`);
  }

  const clip = { ...located.clip, startFrame: command.startFrame };
  next.tracks[located.trackIndex].clips.splice(located.clipIndex, 1);

  const targetTrackId = command.targetTrackId ?? located.track.id;
  const targetTrackIndex = findTrackIndex(next, targetTrackId);
  if (targetTrackIndex < 0) {
    throw new Error(`Track not found: ${targetTrackId}`);
  }

  if (next.tracks[targetTrackIndex].locked) {
    throw new Error(`Track is locked: ${targetTrackId}`);
  }

  next.tracks[targetTrackIndex].clips.push(clip);
  next.tracks[targetTrackIndex].clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  return next;
};

const splitClip = (project: ProjectAst, command: Extract<ProjectCommand, { type: "splitClip" }>): ProjectAst => {
  const next = cloneProject(project);
  const located = findClip(next, command.clipId);
  if (!located) {
    throw new Error(`Clip not found: ${command.clipId}`);
  }
  if (located.track.locked) {
    throw new Error(`Track is locked: ${located.track.id}`);
  }

  const clip = located.clip;
  const endFrame = clip.startFrame + clip.durationFrames;
  if (command.atFrame <= clip.startFrame || command.atFrame >= endFrame) {
    throw new Error(`Split frame must be inside clip range: ${command.clipId}`);
  }

  const firstDuration = command.atFrame - clip.startFrame;
  const secondDuration = endFrame - command.atFrame;
  const secondClip: Clip = {
    ...structuredClone(clip),
    id: command.newClipId ?? `${clip.id}-split-${command.atFrame}`,
    name: `${clip.name} copy`,
    startFrame: command.atFrame,
    durationFrames: secondDuration
  };

  if (secondClip.type === "media") {
    secondClip.sourceInFrame += firstDuration;
    secondClip.sourceDurationFrames = secondDuration;
  }

  const firstClip: Clip =
    clip.type === "media"
      ? { ...clip, durationFrames: firstDuration, sourceDurationFrames: firstDuration }
      : { ...clip, durationFrames: firstDuration };

  next.tracks[located.trackIndex].clips.splice(located.clipIndex, 1, firstClip, secondClip);
  next.tracks[located.trackIndex].clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  return next;
};

const removeClipFromProject = (project: ProjectAst, clipId: string, ripple: boolean): ProjectAst => {
  const next = cloneProject(project);
  const located = findClip(next, clipId);
  if (!located) {
    throw new Error(`Clip not found: ${clipId}`);
  }
  if (located.track.locked) {
    throw new Error(`Track is locked: ${located.track.id}`);
  }

  const removedClip = located.clip;
  const removedEndFrame = removedClip.startFrame + removedClip.durationFrames;
  const track = next.tracks[located.trackIndex];
  track.clips.splice(located.clipIndex, 1);

  if (ripple) {
    track.clips = track.clips.map((clip) =>
      clip.startFrame >= removedEndFrame ? { ...clip, startFrame: Math.max(0, clip.startFrame - removedClip.durationFrames) } : clip
    );
    track.clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  }

  return next;
};

export const applyCommand = (project: ProjectAst, command: ProjectCommand): ProjectAst => {
  switch (command.type) {
    case "importAsset": {
      const next = cloneProject(project);
      if (next.assets.some((asset) => asset.id === command.asset.id)) {
        throw new Error(`Asset already exists: ${command.asset.id}`);
      }
      next.assets.push(command.asset);
      return next;
    }
    case "addTrack": {
      const next = cloneProject(project);
      if (next.tracks.some((track) => track.id === command.track.id)) {
        throw new Error(`Track already exists: ${command.track.id}`);
      }
      next.tracks.push(command.track);
      return next;
    }
    case "updateTrackState": {
      const next = cloneProject(project);
      const track = next.tracks.find((candidate) => candidate.id === command.trackId);
      if (!track) {
        throw new Error(`Track not found: ${command.trackId}`);
      }
      track.locked = command.locked ?? track.locked;
      track.muted = command.muted ?? track.muted;
      track.solo = command.solo ?? track.solo;
      return next;
    }
    case "addClip": {
      const next = cloneProject(project);
      const track = assertTrack(next, command.trackId);
      track.clips.push(command.clip);
      track.clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
      return next;
    }
    case "trimClip":
      return replaceClip(project, command.clipId, (clip) => ({
        ...clip,
        startFrame: command.startFrame ?? clip.startFrame,
        durationFrames: command.durationFrames ?? clip.durationFrames,
        ...(clip.type === "media"
          ? {
              sourceInFrame: command.sourceInFrame ?? clip.sourceInFrame,
              sourceDurationFrames: command.durationFrames ?? clip.sourceDurationFrames
            }
          : {})
      }));
    case "moveClip":
      return moveClip(project, command);
    case "splitClip":
      return splitClip(project, command);
    case "updateCaption":
      return replaceClip(project, command.clipId, (clip) => {
        if (clip.type !== "caption") {
          throw new Error(`Clip is not a caption: ${command.clipId}`);
        }
        return {
          ...clip,
          text: command.text ?? clip.text,
          startFrame: command.startFrame ?? clip.startFrame,
          durationFrames: command.durationFrames ?? clip.durationFrames
        };
      });
    case "updateText":
      return replaceClip(project, command.clipId, (clip) => {
        if (!("text" in clip)) {
          throw new Error(`Clip is not a text object: ${command.clipId}`);
        }
        return {
          ...clip,
          text: command.text ?? clip.text,
          startFrame: command.startFrame ?? clip.startFrame,
          durationFrames: command.durationFrames ?? clip.durationFrames
        };
      });
    case "removeClip": {
      return removeClipFromProject(project, command.clipId, false);
    }
    case "rippleRemoveClip":
      return removeClipFromProject(project, command.clipId, true);
    case "setVolume":
      return replaceClip(project, command.clipId, (clip) => {
        if (clip.type !== "media") {
          throw new Error(`Clip does not have audio properties: ${command.clipId}`);
        }
        return { ...clip, audio: { ...clip.audio, volume: staticNumber(command.volume) } };
      });
    case "addTitle": {
      const next = cloneProject(project);
      const track = assertTrack(next, command.trackId);
      track.clips.push(command.clip);
      track.clips.sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
      return next;
    }
    case "updateRenderSettings": {
      const next = cloneProject(project);
      next.render = {
        ...next.render,
        ...command.render,
        size: { ...next.render.size, ...command.render.size },
        fps: { ...next.render.fps, ...command.render.fps }
      };
      return next;
    }
    case "addMarker": {
      const next = cloneProject(project);
      if (next.markers.some((marker) => marker.id === command.marker.id)) {
        throw new Error(`Marker already exists: ${command.marker.id}`);
      }
      next.markers.push(command.marker);
      next.markers.sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
      return next;
    }
    case "removeMarker": {
      const next = cloneProject(project);
      const markerIndex = next.markers.findIndex((marker) => marker.id === command.markerId);
      if (markerIndex < 0) {
        throw new Error(`Marker not found: ${command.markerId}`);
      }
      next.markers.splice(markerIndex, 1);
      return next;
    }
    case "updateClipMeta":
      return replaceClip(project, command.clipId, (clip) => ({
        ...clip,
        meta: {
          ...clip.meta,
          ...command.meta
        }
      }));
    case "updateClipTransform":
      return replaceClip(project, command.clipId, (clip) => ({
        ...clip,
        transform: {
          ...clip.transform,
          position: command.position ? staticPoint(command.position.x, command.position.y) : clip.transform.position,
          scale: command.scale ? staticPoint(command.scale.x, command.scale.y) : clip.transform.scale,
          opacity: command.opacity !== undefined ? staticNumber(command.opacity) : clip.transform.opacity,
          rotation: command.rotation !== undefined ? staticNumber(command.rotation) : clip.transform.rotation,
          anchor: command.anchor ? staticPoint(command.anchor.x, command.anchor.y) : clip.transform.anchor
        }
      }));
    case "addEffect": {
      const next = cloneProject(project);
      const track = next.tracks.find((candidate) => candidate.id === command.targetId);
      if (track) {
        if (track.locked) {
          throw new Error(`Track is locked: ${track.id}`);
        }
        track.effects.push(command.effect);
        return next;
      }
      const located = findClip(next, command.targetId);
      if (!located) {
        throw new Error(`Effect target not found: ${command.targetId}`);
      }
      if (located.track.locked) {
        throw new Error(`Track is locked: ${located.track.id}`);
      }
      next.tracks[located.trackIndex].clips[located.clipIndex].effects.push(command.effect);
      return next;
    }
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported command: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const applyCommands = (project: ProjectAst, commands: ProjectCommand[]): ProjectAst =>
  commands.reduce((current, command) => applyCommand(current, command), project);

export const applyCommandsChecked = (
  project: ProjectAst,
  commands: ProjectCommand[]
): { project: ProjectAst; diff: ProjectDiff; warnings: string[] } => {
  const beforeValidation = validateProject(project);
  if (!beforeValidation.ok) {
    throw new Error(`Project is invalid before command: ${beforeValidation.errors.join("; ")}`);
  }

  const next = applyCommands(project, commands);
  const afterValidation = validateProject(next);
  if (!afterValidation.ok) {
    throw new Error(`Command produced invalid project: ${afterValidation.errors.join("; ")}`);
  }

  return {
    project: next,
    diff: diffProjects(project, next),
    warnings: afterValidation.warnings
  };
};
