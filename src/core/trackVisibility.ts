import type { ProjectAst, Track } from "./types";

export const hasSoloTracks = (project: ProjectAst): boolean => project.tracks.some((track) => track.solo);

export const isTrackAudibleOrVisible = (
  project: ProjectAst,
  track: Track,
  soloTracksExist = hasSoloTracks(project)
): boolean => {
  if (track.muted) return false;
  return !soloTracksExist || track.solo;
};
