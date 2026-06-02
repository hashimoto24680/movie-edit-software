import { create } from "zustand";
import { applyCommandsChecked } from "../core/commands";
import { alignHorizontalPosition, alignVerticalPosition, type HorizontalAlign, type VerticalAlign } from "../core/canvasAlign";
import { calculateCanvasFitScale, centerPosition, type CanvasFitMode } from "../core/canvasFit";
import { defaultAudio, defaultTransform, emptyEffect, staticNumber, staticPoint } from "../core/defaults";
import { createHistory, currentProjectFromHistory, redoHistory, undoHistory, commitHistory, type HistoryState } from "../core/history";
import { ffmpegRenderer, type FfmpegManifest } from "../core/renderers/ffmpeg";
import { sampleProject } from "../core/sampleProject";
import { parseProjectFileJson, serializeProject, serializeProjectFile } from "../core/serializer";
import { secondsToFrames } from "../core/time";
import { nearestTimelineBoundary } from "../core/timelineNavigation";
import { allClips } from "../core/validation";
import type { Asset, AssetKind, CommandGroup, Point2D, ProjectAst, ProjectCommand, Track } from "../core/types";

export interface ImportedAssetFile {
  name: string;
  path: string;
  kind: AssetKind;
  durationFrames?: number;
  width?: number;
  height?: number;
  sampleRate?: number;
}

interface ProjectStore {
  project: ProjectAst;
  history: HistoryState;
  selectedClipId: string;
  selectedClipIds: string[];
  playheadFrame: number;
  timelineSnappingEnabled: boolean;
  llmText: string;
  renderPlan: FfmpegManifest | null;
  renderStatus: string | null;
  renderWarnings: string[];
  lastError: string | null;
  astJson: string;
  frameSelection: { startFrame: number | null; endFrame: number | null };
  llmStatus: string;
  setSelectedClipId: (clipId: string) => void;
  setSelectedClipIds: (clipIds: string[]) => void;
  toggleSelectedClipId: (clipId: string) => void;
  selectAllClips: () => void;
  selectTrackClips: (trackId: string) => void;
  clearSelection: () => void;
  toggleTimelineSnapping: () => void;
  setPlayheadFrame: (frame: number) => void;
  selectTimelineFrame: (frame: number) => void;
  addMarkerAtPlayhead: () => void;
  removeMarker: (markerId: string) => void;
  removeMarkerAtPlayhead: () => void;
  jumpPlayheadToMarker: (direction: "previous" | "next") => void;
  updateMarker: (markerId: string, patch: { frame?: number; label?: string; color?: string }) => void;
  setLlmText: (text: string) => void;
  submitLlmPrompt: () => Promise<void>;
  commitCommands: (label: string, commands: ProjectCommand[], source: CommandGroup["source"]) => boolean;
  undo: () => void;
  redo: () => void;
  addTextAtPlayhead: () => void;
  splitSelectedClipAtPlayhead: () => void;
  removeSelectedClip: () => void;
  rippleRemoveSelectedClip: () => void;
  duplicateSelectedClip: () => void;
  duplicateSelectedClipAtPlayhead: () => void;
  addUnsupportedEffectToSelected: () => void;
  updateSelectedText: (text: string) => void;
  updateSelectedTextStyle: (patch: Record<string, unknown>) => void;
  setSelectedVolume: (volume: number) => void;
  setSelectedStartFrame: (startFrame: number) => void;
  setSelectedDurationFrames: (durationFrames: number) => void;
  importAssetFiles: (files: ImportedAssetFile[]) => void;
  updateCanvasSize: (width: number, height: number) => void;
  toggleTrackLocked: (trackId: string) => void;
  toggleTrackMuted: (trackId: string) => void;
  toggleTrackSolo: (trackId: string) => void;
  moveClipOnTimeline: (clipId: string, targetTrackId: string, startFrame: number) => void;
  moveSelectedClipsOnTimeline: (anchorClipId: string, targetTrackId: string, startFrame: number) => void;
  trimClipOnTimeline: (clipId: string, edge: "start" | "end", boundaryFrame: number) => void;
  nudgeSelectedClips: (deltaFrames: number) => void;
  moveSelectedClipLayer: (direction: "up" | "down") => void;
  moveSelectedClipToPlayhead: () => void;
  moveSelectedClipToAdjacentBoundary: (direction: "previous" | "next") => void;
  jumpPlayheadToSelectedBoundary: (boundary: "start" | "end") => void;
  jumpPlayheadToTimelineBoundary: (direction: "previous" | "next") => void;
  centerSelectedOnCanvas: () => void;
  fitSelectedToCanvas: (mode: CanvasFitMode) => void;
  alignSelectedHorizontally: (align: HorizontalAlign) => void;
  alignSelectedVertically: (align: VerticalAlign) => void;
  updateSelectedTransform: (patch: {
    position?: Point2D;
    scale?: Point2D;
    opacity?: number;
    rotation?: number;
  }) => void;
  exportProjectFileText: () => string;
  loadProjectFileText: (text: string) => void;
  generateRenderPlan: () => void;
  exportVideo: () => Promise<void>;
  resetSample: () => void;
}

const initialHistory = createHistory(sampleProject);

const commandGroup = (
  label: string,
  commands: ProjectCommand[],
  source: CommandGroup["source"]
): CommandGroup => ({
  id: `${source}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  label,
  commands,
  source,
  createdAt: new Date().toISOString()
});

const syncFromHistory = (history: HistoryState) => {
  const project = currentProjectFromHistory(history);
  return {
    history,
    project,
    astJson: serializeProject(project)
  };
};

const nextClipIdInSameTrack = (project: ProjectAst, clipId: string): string => {
  const track = project.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
  if (!track) return "";
  const sortedClips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  const selectedIndex = sortedClips.findIndex((clip) => clip.id === clipId);
  return sortedClips[selectedIndex + 1]?.id ?? sortedClips[selectedIndex - 1]?.id ?? "";
};

const clipFitsTrack = (track: Track, startFrame: number, durationFrames: number): boolean => {
  const endFrame = startFrame + durationFrames;
  return track.clips.every((clip) => endFrame <= clip.startFrame || startFrame >= clip.startFrame + clip.durationFrames);
};

const nextFreeStartFrame = (track: Track, desiredStartFrame: number, durationFrames: number, excludedClipId: string): number => {
  const otherClips = track.clips.filter((clip) => clip.id !== excludedClipId).sort((a, b) => a.startFrame - b.startFrame);
  let startFrame = Math.max(0, desiredStartFrame);
  for (const clip of otherClips) {
    const endFrame = startFrame + durationFrames;
    if (endFrame <= clip.startFrame) return startFrame;
    if (startFrame < clip.startFrame + clip.durationFrames) {
      startFrame = clip.startFrame + clip.durationFrames;
    }
  }
  return startFrame;
};

const trackForNewObject = (
  project: ProjectAst,
  kind: Track["kind"],
  startFrame: number,
  durationFrames: number
): Track | undefined => {
  const candidates = [
    ...project.tracks.filter((track) => track.kind === kind),
    ...project.tracks.filter((track) => track.kind === "layer"),
    ...project.tracks
  ];
  return candidates.find((track) => !track.locked && clipFitsTrack(track, startFrame, durationFrames));
};

const safeIdPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "asset";

const selectedStaticPosition = (project: ProjectAst, selectedClipId: string): Point2D | null => {
  const selected = allClips(project).find(({ clip }) => clip.id === selectedClipId)?.clip;
  if (!selected || !("transform" in selected)) return null;
  return selected.transform.position.mode === "static" ? selected.transform.position.value : { x: 0.5, y: 0.5 };
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: sampleProject,
  history: initialHistory,
  selectedClipId: "clip-talk-1",
  selectedClipIds: ["clip-talk-1"],
  playheadFrame: 0,
  timelineSnappingEnabled: true,
  llmText: "この動画を横型SNS向けにして、字幕を読みやすく配置してください。",
  renderPlan: null,
  renderStatus: null,
  renderWarnings: [],
  lastError: null,
  astJson: serializeProject(sampleProject),
  frameSelection: { startFrame: null, endFrame: null },
  llmStatus: "LLMへの自然文指示をここに入力できます。",
  setSelectedClipId: (selectedClipId) => set({ selectedClipId, selectedClipIds: selectedClipId ? [selectedClipId] : [] }),
  setSelectedClipIds: (clipIds) => {
    const existingClipIds = allClips(get().project).map(({ clip }) => clip.id);
    const selectedClipIds = clipIds.filter((clipId, index) => existingClipIds.includes(clipId) && clipIds.indexOf(clipId) === index);
    set({ selectedClipId: selectedClipIds.at(-1) ?? "", selectedClipIds });
  },
  toggleSelectedClipId: (clipId) => {
    const { selectedClipIds } = get();
    const nextSelectedClipIds = selectedClipIds.includes(clipId)
      ? selectedClipIds.filter((selectedId) => selectedId !== clipId)
      : [...selectedClipIds, clipId];
    set({
      selectedClipId: nextSelectedClipIds.at(-1) ?? "",
      selectedClipIds: nextSelectedClipIds
    });
  },
  selectAllClips: () => {
    const selectedClipIds = get().project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    set({ selectedClipId: selectedClipIds.at(-1) ?? "", selectedClipIds });
  },
  selectTrackClips: (trackId) => {
    const track = get().project.tracks.find((candidate) => candidate.id === trackId);
    const selectedClipIds = track?.clips.map((clip) => clip.id) ?? [];
    set({ selectedClipId: selectedClipIds.at(-1) ?? "", selectedClipIds });
  },
  clearSelection: () => set({ selectedClipId: "", selectedClipIds: [] }),
  toggleTimelineSnapping: () => set((state) => ({ timelineSnappingEnabled: !state.timelineSnappingEnabled })),
  setPlayheadFrame: (playheadFrame) => set({ playheadFrame }),
  selectTimelineFrame: (frame) => {
    const { frameSelection } = get();
    if (frameSelection.startFrame === null || frameSelection.endFrame !== null) {
      set({ frameSelection: { startFrame: frame, endFrame: null }, playheadFrame: frame });
      return;
    }
    set({
      frameSelection: {
        startFrame: Math.min(frameSelection.startFrame, frame),
        endFrame: Math.max(frameSelection.startFrame, frame)
      },
      playheadFrame: frame
    });
  },
  addMarkerAtPlayhead: () => {
    const { project, playheadFrame } = get();
    const frame = Math.max(0, Math.round(playheadFrame));
    if (project.markers.some((marker) => marker.frame === frame)) {
      set({ lastError: "この位置にはすでにマーカーがあります。" });
      return;
    }
    get().commitCommands(
      "Add timeline marker",
      [
        {
          type: "addMarker",
          marker: {
            id: `marker-${frame}-${Date.now()}`,
            frame,
            label: `Marker ${project.markers.length + 1}`,
            color: "#f3d77c",
            meta: {}
          }
        }
      ],
      "gui"
    );
  },
  removeMarker: (markerId) => {
    get().commitCommands("Remove timeline marker", [{ type: "removeMarker", markerId }], "gui");
  },
  removeMarkerAtPlayhead: () => {
    const { project, playheadFrame } = get();
    const frame = Math.max(0, Math.round(playheadFrame));
    const marker = project.markers.find((candidate) => candidate.frame === frame);
    if (!marker) {
      set({ lastError: "現在位置に削除できるマーカーがありません。" });
      return;
    }
    get().removeMarker(marker.id);
  },
  jumpPlayheadToMarker: (direction) => {
    const { project, playheadFrame } = get();
    const sortedMarkers = [...project.markers].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
    const marker =
      direction === "previous"
        ? [...sortedMarkers].reverse().find((candidate) => candidate.frame < playheadFrame)
        : sortedMarkers.find((candidate) => candidate.frame > playheadFrame);
    if (!marker) {
      set({ lastError: direction === "previous" ? "前のマーカーがありません。" : "次のマーカーがありません。" });
      return;
    }
    set({ playheadFrame: marker.frame, frameSelection: { startFrame: null, endFrame: null }, lastError: null });
  },
  updateMarker: (markerId, patch) => {
    const safeLabel = patch.label !== undefined ? patch.label.trim() || "Marker" : undefined;
    get().commitCommands(
      "Update timeline marker",
      [
        {
          type: "updateMarker",
          markerId,
          ...(patch.frame !== undefined ? { frame: Math.max(0, Math.round(patch.frame)) } : {}),
          ...(safeLabel !== undefined ? { label: safeLabel } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {})
        }
      ],
      "gui"
    );
  },
  setLlmText: (llmText) => set({ llmText }),
  submitLlmPrompt: async () => {
    const { llmText, project } = get();
    if (!llmText.trim()) {
      set({ llmStatus: "指示文が空です。", lastError: null });
      return;
    }
    if (window.desktopProject?.sendLlmPrompt) {
      const result = await window.desktopProject.sendLlmPrompt({
        prompt: llmText.trim(),
        projectText: serializeProjectFile(project)
      });
      set({ llmStatus: result, lastError: null });
      return;
    }
    set({
      llmStatus: `デスクトップ版ではLLMへ送る予定の指示: ${llmText.trim()}`,
      lastError: null
    });
  },
  commitCommands: (label, commands, source) => {
    const { history, project } = get();
    try {
      const checked = applyCommandsChecked(project, commands);
      const nextHistory = commitHistory(history, commandGroup(label, commands, source));
      set({
        ...syncFromHistory(nextHistory),
        renderPlan: null,
        renderStatus: null,
        renderWarnings: checked.warnings,
        lastError: null
      });
      return true;
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },
  undo: () => {
    const nextHistory = undoHistory(get().history);
    set({ ...syncFromHistory(nextHistory), renderPlan: null, renderStatus: null, lastError: null });
  },
  redo: () => {
    const nextHistory = redoHistory(get().history);
    set({ ...syncFromHistory(nextHistory), renderPlan: null, renderStatus: null, lastError: null });
  },
  addTextAtPlayhead: () => {
    const { project, playheadFrame } = get();
    const id = `text-${Date.now()}`;
    const durationFrames = secondsToFrames(3, project.render.fps);
    const track = trackForNewObject(project, "overlay", playheadFrame, durationFrames);
    if (!track) {
      set({ lastError: "テキストを置ける空きレイヤーがありません。" });
      return;
    }
    const added = get().commitCommands(
      "Add text",
      [
        {
          type: "addTitle",
          trackId: track.id,
          clip: {
            id,
            type: "title",
            name: "Text",
            startFrame: playheadFrame,
            durationFrames,
            text: "新しいテキスト",
            styleId: "text-default",
            transform: { ...defaultTransform(), position: staticPoint(0.5, 0.5), scale: staticPoint(0.9, 1) },
            effects: [],
            meta: {}
          }
        }
      ],
      "gui"
    );
    if (added) set({ selectedClipId: id, selectedClipIds: [id] });
  },
  splitSelectedClipAtPlayhead: () => {
    const { project, selectedClipId, selectedClipIds, playheadFrame } = get();
    const clips = allClips(project);
    const targetClips = (selectedClipIds.length > 1 ? selectedClipIds : [selectedClipId])
      .map((clipId) => clips.find(({ clip }) => clip.id === clipId)?.clip)
      .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip))
      .filter((clip) => playheadFrame > clip.startFrame && playheadFrame < clip.startFrame + clip.durationFrames);
    if (selectedClipIds.length > 1) {
      if (targetClips.length === 0) {
        set({ lastError: "分割位置が内側にある選択オブジェクトがありません。" });
        return;
      }
      const commands: ProjectCommand[] = targetClips.map((clip) => ({
        type: "splitClip",
        clipId: clip.id,
        atFrame: playheadFrame,
        newClipId: `${clip.id}-split-${playheadFrame}`
      }));
      const added = get().commitCommands("Split selected timeline objects", commands, "gui");
      if (added) {
        const newClipIds = commands.map((command) => (command.type === "splitClip" ? command.newClipId ?? `${command.clipId}-split-${playheadFrame}` : ""));
        set({ selectedClipId: newClipIds.at(-1) ?? "", selectedClipIds: newClipIds });
      }
      return;
    }

    const selected = clips.find(({ clip }) => clip.id === selectedClipId)?.clip;
    if (!selected) {
      set({ lastError: "分割するオブジェクトを選択してください。" });
      return;
    }
    const clipEndFrame = selected.startFrame + selected.durationFrames;
    if (playheadFrame <= selected.startFrame || playheadFrame >= clipEndFrame) {
      set({ lastError: "分割位置は選択オブジェクトの内側に置いてください。" });
      return;
    }
    const newClipId = `${selected.id}-split-${playheadFrame}`;
    const added = get().commitCommands(
      "Split timeline object",
      [{ type: "splitClip", clipId: selected.id, atFrame: playheadFrame, newClipId }],
      "gui"
    );
    if (added) set({ selectedClipId: newClipId, selectedClipIds: [newClipId] });
  },
  removeSelectedClip: () => {
    const { project, selectedClipId, selectedClipIds } = get();
    const clips = allClips(project);
    const selectedIds = selectedClipIds.filter((clipId) => clips.some(({ clip }) => clip.id === clipId));
    const targetIds = selectedIds.length > 0 ? selectedIds : selectedClipId ? [selectedClipId] : [];
    if (targetIds.length === 0) {
      set({ lastError: "削除するオブジェクトを選択してください。" });
      return;
    }
    const selectedIndex = clips.findIndex(({ clip }) => clip.id === targetIds.at(-1));
    const nextSelectedClipId =
      clips.slice(selectedIndex + 1).find(({ clip }) => !targetIds.includes(clip.id))?.clip.id ??
      [...clips.slice(0, selectedIndex)].reverse().find(({ clip }) => !targetIds.includes(clip.id))?.clip.id ??
      "";
    const removed = get().commitCommands(
      targetIds.length > 1 ? "Remove selected timeline objects" : "Remove timeline object",
      targetIds.map((clipId) => ({ type: "removeClip", clipId })),
      "gui"
    );
    if (removed) set({ selectedClipId: nextSelectedClipId, selectedClipIds: nextSelectedClipId ? [nextSelectedClipId] : [] });
  },
  rippleRemoveSelectedClip: () => {
    const { project, selectedClipId, selectedClipIds } = get();
    const clips = allClips(project);
    const selectedLocations = selectedClipIds
      .map((clipId) => clips.find(({ clip }) => clip.id === clipId))
      .filter((located): located is NonNullable<typeof located> => Boolean(located));
    const targetLocations = selectedLocations.length > 0 ? selectedLocations : clips.filter(({ clip }) => clip.id === selectedClipId);
    if (targetLocations.length === 0) {
      set({ lastError: "リップル削除するオブジェクトを選択してください。" });
      return;
    }
    const sortedTargets = [...targetLocations].sort((a, b) => {
      const trackOrder = project.tracks.findIndex((track) => track.id === a.track.id) - project.tracks.findIndex((track) => track.id === b.track.id);
      return trackOrder || a.clip.startFrame - b.clip.startFrame || a.clip.id.localeCompare(b.clip.id);
    });
    const targetIds = sortedTargets.map(({ clip }) => clip.id);
    const selectedIndex = clips.findIndex(({ clip }) => clip.id === targetIds.at(-1));
    const nextSelectedClipId =
      clips.slice(selectedIndex + 1).find(({ clip }) => !targetIds.includes(clip.id))?.clip.id ??
      [...clips.slice(0, selectedIndex)].reverse().find(({ clip }) => !targetIds.includes(clip.id))?.clip.id ??
      "";
    const removed = get().commitCommands(
      targetIds.length > 1 ? "Ripple remove selected timeline objects" : "Ripple remove timeline object",
      targetIds.map((clipId) => ({ type: "rippleRemoveClip", clipId })),
      "gui"
    );
    if (removed) set({ selectedClipId: nextSelectedClipId, selectedClipIds: nextSelectedClipId ? [nextSelectedClipId] : [] });
  },
  duplicateSelectedClip: () => {
    const { project, selectedClipId, selectedClipIds } = get();
    const clips = allClips(project);
    const selectedLocations = selectedClipIds
      .map((clipId) => clips.find(({ clip }) => clip.id === clipId))
      .filter((located): located is NonNullable<typeof located> => Boolean(located));
    if (selectedLocations.length > 1) {
      if (selectedLocations.some(({ track }) => track.locked)) {
        set({ lastError: "ロック中のレイヤーでは複製できません。" });
        return;
      }
      const batchId = Date.now();
      const duplicateIds: string[] = [];
      const sortedLocations = selectedLocations.sort(
        (a, b) => a.clip.startFrame - b.clip.startFrame || a.clip.id.localeCompare(b.clip.id)
      );
      const groupStartFrame = Math.min(...sortedLocations.map(({ clip }) => clip.startFrame));
      const groupEndFrame = Math.max(...sortedLocations.map(({ clip }) => clip.startFrame + clip.durationFrames));
      const groupDurationFrames = Math.max(1, groupEndFrame - groupStartFrame);
      const buildCommands = (offsetFrames: number): ProjectCommand[] =>
        sortedLocations.map(({ track, clip }, index) => {
          const duplicateId = `${clip.id}-copy-${batchId}-${index}`;
          return {
            type: "addClip",
            trackId: track.id,
            clip: {
              ...structuredClone(clip),
              id: duplicateId,
              name: `${clip.name} copy`,
              startFrame: clip.startFrame + offsetFrames
            }
          };
        });
      let commands: ProjectCommand[] = [];
      for (let step = 1; step <= 50; step += 1) {
        const candidateCommands = buildCommands(groupDurationFrames * step);
        try {
          applyCommandsChecked(project, candidateCommands);
          commands = candidateCommands;
          break;
        } catch {
          // Keep looking for a later free slot on every involved layer.
        }
      }
      if (commands.length === 0) {
        set({ lastError: "複製グループを置ける空き位置がありません。" });
        return;
      }
      duplicateIds.push(...commands.map((command) => (command.type === "addClip" ? command.clip.id : "")));
      const added = get().commitCommands("Duplicate selected timeline objects", commands, "gui");
      if (added) set({ selectedClipId: duplicateIds.at(-1) ?? "", selectedClipIds: duplicateIds });
      return;
    }

    const located = clips.find(({ clip }) => clip.id === selectedClipId);
    if (!located) {
      set({ lastError: "複製するオブジェクトを選択してください。" });
      return;
    }
    if (located.track.locked) {
      set({ lastError: "ロック中のレイヤーでは複製できません。" });
      return;
    }
    const duplicateId = `${located.clip.id}-copy-${Date.now()}`;
    const startFrame = nextFreeStartFrame(
      located.track,
      located.clip.startFrame + located.clip.durationFrames,
      located.clip.durationFrames,
      located.clip.id
    );
    const clip = {
      ...structuredClone(located.clip),
      id: duplicateId,
      name: `${located.clip.name} copy`,
      startFrame
    };
    const added = get().commitCommands(
      "Duplicate timeline object",
      [{ type: "addClip", trackId: located.track.id, clip }],
      "gui"
    );
    if (added) set({ selectedClipId: duplicateId, selectedClipIds: [duplicateId] });
  },
  duplicateSelectedClipAtPlayhead: () => {
    const { project, selectedClipId, selectedClipIds, playheadFrame } = get();
    const clips = allClips(project);
    const selectedLocations = selectedClipIds
      .map((clipId) => clips.find(({ clip }) => clip.id === clipId))
      .filter((located): located is NonNullable<typeof located> => Boolean(located));
    if (selectedLocations.length > 1) {
      if (selectedLocations.some(({ track }) => track.locked)) {
        set({ lastError: "ロック中のレイヤーでは複製できません。" });
        return;
      }
      const batchId = Date.now();
      const sortedLocations = selectedLocations.sort(
        (a, b) => a.clip.startFrame - b.clip.startFrame || a.clip.id.localeCompare(b.clip.id)
      );
      const groupStartFrame = Math.min(...sortedLocations.map(({ clip }) => clip.startFrame));
      const duplicateIds: string[] = [];
      const commands: ProjectCommand[] = sortedLocations.map(({ track, clip }, index) => {
        const duplicateId = `${clip.id}-copy-${batchId}-${index}`;
        duplicateIds.push(duplicateId);
        return {
          type: "addClip",
          trackId: track.id,
          clip: {
            ...structuredClone(clip),
            id: duplicateId,
            name: `${clip.name} copy`,
            startFrame: Math.max(0, playheadFrame) + (clip.startFrame - groupStartFrame)
          }
        };
      });
      const added = get().commitCommands("Duplicate selected timeline objects at playhead", commands, "gui");
      if (added) set({ selectedClipId: duplicateIds.at(-1) ?? "", selectedClipIds: duplicateIds });
      return;
    }

    const located = clips.find(({ clip }) => clip.id === selectedClipId);
    if (!located) {
      set({ lastError: "再生ヘッドへ複製するオブジェクトを選択してください。" });
      return;
    }
    if (located.track.locked) {
      set({ lastError: "ロック中のレイヤーでは複製できません。" });
      return;
    }
    const duplicateId = `${located.clip.id}-copy-${Date.now()}`;
    const clip = {
      ...structuredClone(located.clip),
      id: duplicateId,
      name: `${located.clip.name} copy`,
      startFrame: Math.max(0, playheadFrame)
    };
    const added = get().commitCommands(
      "Duplicate timeline object at playhead",
      [{ type: "addClip", trackId: located.track.id, clip }],
      "gui"
    );
    if (added) set({ selectedClipId: duplicateId, selectedClipIds: [duplicateId] });
  },
  addUnsupportedEffectToSelected: () => {
    const { selectedClipId } = get();
    get().commitCommands(
      "Add future effect node",
      [
        {
          type: "addEffect",
          targetId: selectedClipId,
          effect: {
            ...emptyEffect(`fx-${Date.now()}`, "future-glow", "Future Glow"),
            params: { intensity: staticNumber(0.6) },
            meta: { note: "Preserved for future renderer support" }
          }
        }
      ],
      "gui"
    );
  },
  updateSelectedText: (text) => {
    const { selectedClipId } = get();
    get().commitCommands("Update text", [{ type: "updateText", clipId: selectedClipId, text }], "gui");
  },
  updateSelectedTextStyle: (patch) => {
    const { project, selectedClipId } = get();
    const selected = allClips(project).find(({ clip }) => clip.id === selectedClipId)?.clip;
    if (!selected || !("text" in selected)) return;
    const currentStyle =
      typeof selected.meta.textStyle === "object" && selected.meta.textStyle !== null
        ? (selected.meta.textStyle as Record<string, unknown>)
        : {};
    get().commitCommands(
      "Update text style",
      [
        {
          type: "updateClipMeta",
          clipId: selectedClipId,
          meta: {
            textStyle: {
              ...currentStyle,
              ...patch
            }
          }
        }
      ],
      "gui"
    );
  },
  setSelectedVolume: (volume) => {
    const { selectedClipId } = get();
    get().commitCommands("Set volume", [{ type: "setVolume", clipId: selectedClipId, volume }], "gui");
  },
  setSelectedStartFrame: (startFrame) => {
    const { selectedClipId } = get();
    if (!Number.isFinite(startFrame)) {
      set({ lastError: "開始位置には数値を入力してください。" });
      return;
    }
    get().commitCommands(
      "Set object start",
      [{ type: "moveClip", clipId: selectedClipId, startFrame: Math.max(0, Math.round(startFrame)) }],
      "gui"
    );
  },
  setSelectedDurationFrames: (durationFrames) => {
    const { selectedClipId } = get();
    if (!Number.isFinite(durationFrames) || durationFrames <= 0) {
      set({ lastError: "長さには0より大きい数値を入力してください。" });
      return;
    }
    get().commitCommands(
      "Set object duration",
      [{ type: "trimClip", clipId: selectedClipId, durationFrames: Math.max(1, Math.round(durationFrames)) }],
      "gui"
    );
  },
  importAssetFiles: (files) => {
    const validFiles = files.filter((file) => file.name && file.path);
    if (validFiles.length === 0) return;

    let draft = get().project;
    const commands: ProjectCommand[] = [];
    const createdClipIds: string[] = [];
    const baseFrame = get().playheadFrame;
    const batchId = Date.now();

    for (const [index, file] of validFiles.entries()) {
      const durationFrames =
        file.durationFrames ?? secondsToFrames(file.kind === "audio" ? 8 : 5, draft.render.fps);
      const idPart = safeIdPart(file.name);
      const asset: Asset = {
        id: `asset-${idPart}-${batchId}-${index}`,
        kind: file.kind,
        name: file.name,
        path: file.path,
        durationFrames,
        width: file.width ?? (file.kind === "audio" ? undefined : draft.render.size.width),
        height: file.height ?? (file.kind === "audio" ? undefined : draft.render.size.height),
        sampleRate: file.sampleRate,
        meta: {}
      };
      const startFrame = baseFrame;
      const track = trackForNewObject(draft, "layer", startFrame, durationFrames);
      if (!track) {
        set({
          lastError: `素材 "${file.name}" を置ける空きレイヤーがありません。再生ヘッドを空き時間へ移動するか、既存オブジェクトをずらしてください。`
        });
        return;
      }
      const clipId = `clip-${idPart}-${batchId}-${index}`;
      const clip: ProjectCommand = {
        type: "addClip",
        trackId: track.id,
        clip: {
          id: clipId,
          type: "media",
          name: file.name,
          assetId: asset.id,
          startFrame,
          durationFrames,
          sourceInFrame: 0,
          sourceDurationFrames: durationFrames,
          transform: defaultTransform(),
          audio: defaultAudio(),
          effects: [],
          meta: {}
        }
      };
      const importCommand: ProjectCommand = { type: "importAsset", asset };
      commands.push(importCommand, clip);
      createdClipIds.push(clipId);
      try {
        draft = applyCommandsChecked(draft, [importCommand, clip]).project;
      } catch (error) {
        set({ lastError: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const added = get().commitCommands(`Import ${validFiles.length} asset${validFiles.length > 1 ? "s" : ""}`, commands, "gui");
    if (added) set({ selectedClipId: createdClipIds[0], selectedClipIds: [createdClipIds[0]], renderStatus: null });
  },
  updateCanvasSize: (width, height) => {
    const safeWidth = Math.max(16, Math.round(width));
    const safeHeight = Math.max(16, Math.round(height));
    get().commitCommands(
      `Set canvas ${safeWidth}x${safeHeight}`,
      [{ type: "updateRenderSettings", render: { size: { width: safeWidth, height: safeHeight } } }],
      "gui"
    );
  },
  toggleTrackLocked: (trackId) => {
    const track = get().project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    get().commitCommands("Toggle layer lock", [{ type: "updateTrackState", trackId, locked: !track.locked }], "gui");
  },
  toggleTrackMuted: (trackId) => {
    const track = get().project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    get().commitCommands("Toggle layer mute", [{ type: "updateTrackState", trackId, muted: !track.muted }], "gui");
  },
  toggleTrackSolo: (trackId) => {
    const track = get().project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    get().commitCommands("Toggle layer solo", [{ type: "updateTrackState", trackId, solo: !track.solo }], "gui");
  },
  moveClipOnTimeline: (clipId, targetTrackId, startFrame) => {
    const nextStartFrame = Math.max(0, Math.round(startFrame));
    get().commitCommands(
      "Move timeline object",
      [{ type: "moveClip", clipId, targetTrackId, startFrame: nextStartFrame }],
      "gui"
    );
  },
  moveSelectedClipsOnTimeline: (anchorClipId, targetTrackId, startFrame) => {
    const { project, selectedClipIds } = get();
    const clips = allClips(project);
    const anchor = clips.find(({ clip }) => clip.id === anchorClipId);
    if (!anchor) {
      set({ lastError: "移動するオブジェクトを選択してください。" });
      return;
    }
    const targetTrackIndex = project.tracks.findIndex((track) => track.id === targetTrackId);
    const anchorTrackIndex = project.tracks.findIndex((track) => track.id === anchor.track.id);
    if (targetTrackIndex < 0) {
      set({ lastError: "移動先レイヤーが見つかりません。" });
      return;
    }
    if (anchorTrackIndex < 0) {
      set({ lastError: "移動元レイヤーが見つかりません。" });
      return;
    }
    const groupIds = selectedClipIds.includes(anchorClipId) && selectedClipIds.length > 1 ? selectedClipIds : [anchorClipId];
    const deltaFrames = Math.max(0, Math.round(startFrame)) - anchor.clip.startFrame;
    const deltaTrackIndex = targetTrackIndex - anchorTrackIndex;
    const commands: ProjectCommand[] = [];
    for (const clipId of groupIds) {
      const located = clips.find(({ clip }) => clip.id === clipId);
      if (!located) continue;
      const nextStartFrame = located.clip.startFrame + deltaFrames;
      const locatedTrackIndex = project.tracks.findIndex((track) => track.id === located.track.id);
      const nextTrack = project.tracks[locatedTrackIndex + deltaTrackIndex];
      if (nextStartFrame < 0) {
        set({ lastError: "これ以上左へ移動できません。" });
        return;
      }
      if (!nextTrack) {
        set({ lastError: "選択グループを移動できるレイヤー範囲がありません。" });
        return;
      }
      commands.push({ type: "moveClip", clipId, targetTrackId: nextTrack.id, startFrame: nextStartFrame });
    }
    get().commitCommands(
      groupIds.length > 1 ? "Move selected timeline objects" : "Move timeline object",
      commands,
      "gui"
    );
  },
  trimClipOnTimeline: (clipId, edge, boundaryFrame) => {
    const selected = allClips(get().project).find(({ clip }) => clip.id === clipId)?.clip;
    if (!selected) {
      set({ lastError: "トリムするオブジェクトを選択してください。" });
      return;
    }
    const safeBoundaryFrame = Math.max(0, Math.round(boundaryFrame));
    if (edge === "end") {
      get().commitCommands(
        "Trim timeline object end",
        [{ type: "trimClip", clipId, durationFrames: Math.max(1, safeBoundaryFrame - selected.startFrame) }],
        "gui"
      );
      return;
    }

    const originalEndFrame = selected.startFrame + selected.durationFrames;
    const minimumStartFrame = selected.type === "media" ? Math.max(0, selected.startFrame - selected.sourceInFrame) : 0;
    const nextStartFrame = Math.min(Math.max(minimumStartFrame, safeBoundaryFrame), originalEndFrame - 1);
    const deltaFrames = nextStartFrame - selected.startFrame;
    get().commitCommands(
      "Trim timeline object start",
      [
        {
          type: "trimClip",
          clipId,
          startFrame: nextStartFrame,
          durationFrames: originalEndFrame - nextStartFrame,
          ...(selected.type === "media" ? { sourceInFrame: selected.sourceInFrame + deltaFrames } : {})
        }
      ],
      "gui"
    );
  },
  nudgeSelectedClips: (deltaFrames) => {
    const { project, selectedClipId, selectedClipIds } = get();
    const clips = allClips(project);
    const targetIds = (selectedClipIds.length > 0 ? selectedClipIds : [selectedClipId]).filter((clipId) =>
      clips.some(({ clip }) => clip.id === clipId)
    );
    if (targetIds.length === 0) {
      set({ lastError: "移動するオブジェクトを選択してください。" });
      return;
    }
    const safeDeltaFrames = Math.round(deltaFrames);
    if (safeDeltaFrames === 0) return;
    const commands: ProjectCommand[] = [];
    for (const clipId of targetIds) {
      const located = clips.find(({ clip }) => clip.id === clipId);
      if (!located) continue;
      const startFrame = located.clip.startFrame + safeDeltaFrames;
      if (startFrame < 0) {
        set({ lastError: "これ以上左へ移動できません。" });
        return;
      }
      commands.push({ type: "moveClip", clipId, targetTrackId: located.track.id, startFrame });
    }
    get().commitCommands(
      targetIds.length > 1 ? "Nudge selected timeline objects" : "Nudge timeline object",
      commands,
      "gui"
    );
  },
  moveSelectedClipLayer: (direction) => {
    const { project, selectedClipId } = get();
    const trackIndex = project.tracks.findIndex((track) => track.clips.some((clip) => clip.id === selectedClipId));
    if (trackIndex < 0) {
      set({ lastError: "レイヤー移動するオブジェクトを選択してください。" });
      return;
    }
    const selected = project.tracks[trackIndex].clips.find((clip) => clip.id === selectedClipId);
    const targetTrack = project.tracks[direction === "up" ? trackIndex - 1 : trackIndex + 1];
    if (!selected || !targetTrack) {
      set({ lastError: direction === "up" ? "これ以上上のレイヤーへ移動できません。" : "これ以上下のレイヤーへ移動できません。" });
      return;
    }
    get().commitCommands(
      direction === "up" ? "Move object to upper layer" : "Move object to lower layer",
      [{ type: "moveClip", clipId: selectedClipId, targetTrackId: targetTrack.id, startFrame: selected.startFrame }],
      "gui"
    );
  },
  moveSelectedClipToPlayhead: () => {
    const { project, selectedClipId, playheadFrame } = get();
    const located = allClips(project).find(({ clip }) => clip.id === selectedClipId);
    if (!located) {
      set({ lastError: "再生ヘッドへ移動するオブジェクトを選択してください。" });
      return;
    }
    get().commitCommands(
      "Move object to playhead",
      [{ type: "moveClip", clipId: selectedClipId, targetTrackId: located.track.id, startFrame: Math.max(0, playheadFrame) }],
      "gui"
    );
  },
  moveSelectedClipToAdjacentBoundary: (direction) => {
    const { project, selectedClipId } = get();
    const track = project.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === selectedClipId));
    const selected = track?.clips.find((clip) => clip.id === selectedClipId);
    if (!track || !selected) {
      set({ lastError: "境界へ移動するオブジェクトを選択してください。" });
      return;
    }
    const sortedClips = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
    const selectedIndex = sortedClips.findIndex((clip) => clip.id === selected.id);
    const adjacentClip = direction === "previous" ? sortedClips[selectedIndex - 1] : sortedClips[selectedIndex + 1];
    if (!adjacentClip) {
      set({ lastError: direction === "previous" ? "前に揃えるオブジェクトがありません。" : "次に揃えるオブジェクトがありません。" });
      return;
    }
    const startFrame =
      direction === "previous"
        ? adjacentClip.startFrame + adjacentClip.durationFrames
        : Math.max(0, adjacentClip.startFrame - selected.durationFrames);
    if (startFrame === selected.startFrame) {
      set({ lastError: "すでに隣の境界に揃っています。" });
      return;
    }
    get().commitCommands(
      direction === "previous" ? "Move object to previous adjacent boundary" : "Move object to next adjacent boundary",
      [{ type: "moveClip", clipId: selectedClipId, targetTrackId: track.id, startFrame }],
      "gui"
    );
  },
  jumpPlayheadToSelectedBoundary: (boundary) => {
    const { project, selectedClipId } = get();
    const selected = allClips(project).find(({ clip }) => clip.id === selectedClipId)?.clip;
    if (!selected) {
      set({ lastError: "再生ヘッドを移動するオブジェクトを選択してください。" });
      return;
    }
    set({
      playheadFrame: boundary === "start" ? selected.startFrame : selected.startFrame + selected.durationFrames,
      frameSelection: { startFrame: null, endFrame: null },
      lastError: null
    });
  },
  jumpPlayheadToTimelineBoundary: (direction) => {
    const { project, playheadFrame } = get();
    const frame = nearestTimelineBoundary(project, playheadFrame, direction);
    if (frame === null) {
      set({ lastError: direction === "previous" ? "前の境界がありません。" : "次の境界がありません。" });
      return;
    }
    set({ playheadFrame: frame, frameSelection: { startFrame: null, endFrame: null }, lastError: null });
  },
  centerSelectedOnCanvas: () => {
    const { selectedClipId } = get();
    get().commitCommands(
      "Center selected object",
      [{ type: "updateClipTransform", clipId: selectedClipId, position: centerPosition() }],
      "gui"
    );
  },
  fitSelectedToCanvas: (mode) => {
    const { project, selectedClipId } = get();
    const selected = allClips(project).find(({ clip }) => clip.id === selectedClipId)?.clip;
    if (!selected) {
      set({ lastError: "キャンバスに合わせるオブジェクトを選択してください。" });
      return;
    }
    const asset = selected.type === "media" ? project.assets.find((candidate) => candidate.id === selected.assetId) : undefined;
    const source = asset?.width && asset.height ? { width: asset.width, height: asset.height } : undefined;
    const scale = calculateCanvasFitScale(mode, selected.type === "media" ? "media" : "text", project.render.size, source);
    get().commitCommands(
      mode === "width" ? "Fit selected object to width" : "Fit selected object to height",
      [{ type: "updateClipTransform", clipId: selectedClipId, position: centerPosition(), scale }],
      "gui"
    );
  },
  alignSelectedHorizontally: (align) => {
    const { project, selectedClipId } = get();
    const position = selectedStaticPosition(project, selectedClipId);
    if (!position) {
      set({ lastError: "整列するオブジェクトを選択してください。" });
      return;
    }
    get().commitCommands(
      `Align selected object ${align}`,
      [{ type: "updateClipTransform", clipId: selectedClipId, position: alignHorizontalPosition(position, align) }],
      "gui"
    );
  },
  alignSelectedVertically: (align) => {
    const { project, selectedClipId } = get();
    const position = selectedStaticPosition(project, selectedClipId);
    if (!position) {
      set({ lastError: "整列するオブジェクトを選択してください。" });
      return;
    }
    get().commitCommands(
      `Align selected object ${align}`,
      [{ type: "updateClipTransform", clipId: selectedClipId, position: alignVerticalPosition(position, align) }],
      "gui"
    );
  },
  updateSelectedTransform: (patch) => {
    const { selectedClipId } = get();
    get().commitCommands(
      "Update clip transform",
      [{ type: "updateClipTransform", clipId: selectedClipId, ...patch }],
      "gui"
    );
  },
  exportProjectFileText: () => serializeProjectFile(get().project),
  loadProjectFileText: (text) => {
    try {
      const project = parseProjectFileJson(text);
      const history = createHistory(project);
      const firstClipId = project.tracks.flatMap((track) => track.clips)[0]?.id ?? "";
      set({
        ...syncFromHistory(history),
        selectedClipId: firstClipId,
        selectedClipIds: firstClipId ? [firstClipId] : [],
        playheadFrame: 0,
        frameSelection: { startFrame: null, endFrame: null },
        renderPlan: null,
        renderStatus: null,
        renderWarnings: [],
        lastError: null
      });
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
    }
  },
  generateRenderPlan: () => {
    const plan = ffmpegRenderer.createManifest({
      project: get().project,
      outputPath: "outputs/sample-short.mp4"
    });
    set({
      renderPlan: plan.manifest,
      renderStatus: "FFmpeg renderer manifest を作成しました。",
      renderWarnings: plan.warnings,
      lastError: null
    });
  },
  exportVideo: async () => {
    const { project } = get();
    const plan = ffmpegRenderer.createManifest({
      project,
      outputPath: "movie-edit-output.mp4"
    });
    if (window.desktopProject?.exportVideo) {
      const result = await window.desktopProject.exportVideo({
        manifest: plan.manifest,
        projectText: serializeProjectFile(project)
      });
      if (result.canceled) return;
      set({
        renderPlan: plan.manifest,
        renderStatus: result.message ?? `書き出し設定を保存しました: ${result.manifestPath ?? result.filePath}`,
        renderWarnings: plan.warnings,
        lastError: null
      });
      return;
    }

    const blob = new Blob([JSON.stringify(plan.manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "movie-edit-output.render.json";
    link.click();
    URL.revokeObjectURL(url);
    set({
      renderPlan: plan.manifest,
      renderStatus: "ブラウザ版の書き出し設定を保存しました。",
      renderWarnings: plan.warnings,
      lastError: null
    });
  },
  resetSample: () => {
    const history = createHistory(sampleProject);
    set({
      ...syncFromHistory(history),
      selectedClipId: "clip-talk-1",
      selectedClipIds: ["clip-talk-1"],
      playheadFrame: 0,
      timelineSnappingEnabled: true,
      llmText: "この動画を横型SNS向けにして、字幕を読みやすく配置してください。",
      renderPlan: null,
      renderStatus: null,
      renderWarnings: [],
      lastError: null
    });
  }
}));
