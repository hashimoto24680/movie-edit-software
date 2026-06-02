import { create } from "zustand";
import { applyCommandsChecked } from "../core/commands";
import { defaultAudio, defaultTransform, emptyEffect, staticNumber, staticPoint } from "../core/defaults";
import { createHistory, currentProjectFromHistory, redoHistory, undoHistory, commitHistory, type HistoryState } from "../core/history";
import { ffmpegRenderer, type FfmpegManifest } from "../core/renderers/ffmpeg";
import { sampleProject } from "../core/sampleProject";
import { parseProjectFileJson, serializeProject, serializeProjectFile } from "../core/serializer";
import { secondsToFrames } from "../core/time";
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
  playheadFrame: number;
  llmText: string;
  renderPlan: FfmpegManifest | null;
  renderStatus: string | null;
  renderWarnings: string[];
  lastError: string | null;
  astJson: string;
  frameSelection: { startFrame: number | null; endFrame: number | null };
  llmStatus: string;
  setSelectedClipId: (clipId: string) => void;
  setPlayheadFrame: (frame: number) => void;
  selectTimelineFrame: (frame: number) => void;
  setLlmText: (text: string) => void;
  submitLlmPrompt: () => Promise<void>;
  commitCommands: (label: string, commands: ProjectCommand[], source: CommandGroup["source"]) => boolean;
  undo: () => void;
  redo: () => void;
  addTextAtPlayhead: () => void;
  addUnsupportedEffectToSelected: () => void;
  updateSelectedText: (text: string) => void;
  updateSelectedTextStyle: (patch: Record<string, unknown>) => void;
  setSelectedVolume: (volume: number) => void;
  importAssetFiles: (files: ImportedAssetFile[]) => void;
  updateCanvasSize: (width: number, height: number) => void;
  moveClipOnTimeline: (clipId: string, targetTrackId: string, startFrame: number) => void;
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

const clipFitsTrack = (track: Track, startFrame: number, durationFrames: number): boolean => {
  const endFrame = startFrame + durationFrames;
  return track.clips.every((clip) => endFrame <= clip.startFrame || startFrame >= clip.startFrame + clip.durationFrames);
};

const trackForNewObject = (
  project: ProjectAst,
  kind: Track["kind"],
  startFrame: number,
  durationFrames: number
): Track => {
  const candidates = [
    ...project.tracks.filter((track) => track.kind === kind),
    ...project.tracks.filter((track) => track.kind === "layer"),
    ...project.tracks
  ];
  return candidates.find((track) => !track.locked && clipFitsTrack(track, startFrame, durationFrames)) ?? candidates[0] ?? project.tracks[0];
};

const safeIdPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28) || "asset";

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: sampleProject,
  history: initialHistory,
  selectedClipId: "clip-talk-1",
  playheadFrame: 0,
  llmText: "この動画を横型SNS向けにして、字幕を読みやすく配置してください。",
  renderPlan: null,
  renderStatus: null,
  renderWarnings: [],
  lastError: null,
  astJson: serializeProject(sampleProject),
  frameSelection: { startFrame: null, endFrame: null },
  llmStatus: "LLMへの自然文指示をここに入力できます。",
  setSelectedClipId: (selectedClipId) => set({ selectedClipId }),
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
    if (added) set({ selectedClipId: id });
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
      draft = applyCommandsChecked(draft, [importCommand, clip]).project;
    }

    const added = get().commitCommands(`Import ${validFiles.length} asset${validFiles.length > 1 ? "s" : ""}`, commands, "gui");
    if (added) set({ selectedClipId: createdClipIds[0], renderStatus: null });
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
  moveClipOnTimeline: (clipId, targetTrackId, startFrame) => {
    const nextStartFrame = Math.max(0, Math.round(startFrame));
    get().commitCommands(
      "Move timeline object",
      [{ type: "moveClip", clipId, targetTrackId, startFrame: nextStartFrame }],
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
      set({
        ...syncFromHistory(history),
        selectedClipId: project.tracks.flatMap((track) => track.clips)[0]?.id ?? "",
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
      playheadFrame: 0,
      llmText: "この動画を横型SNS向けにして、字幕を読みやすく配置してください。",
      renderPlan: null,
      renderStatus: null,
      renderWarnings: [],
      lastError: null
    });
  }
}));
