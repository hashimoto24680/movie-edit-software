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
  splitSelectedClipAtPlayhead: () => void;
  removeSelectedClip: () => void;
  rippleRemoveSelectedClip: () => void;
  duplicateSelectedClip: () => void;
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
  moveSelectedClipLayer: (direction: "up" | "down") => void;
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
    if (added) set({ selectedClipId: id });
  },
  splitSelectedClipAtPlayhead: () => {
    const { project, selectedClipId, playheadFrame } = get();
    const selected = allClips(project).find(({ clip }) => clip.id === selectedClipId)?.clip;
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
    if (added) set({ selectedClipId: newClipId });
  },
  removeSelectedClip: () => {
    const { project, selectedClipId } = get();
    const clips = allClips(project);
    const selectedIndex = clips.findIndex(({ clip }) => clip.id === selectedClipId);
    if (selectedIndex < 0) {
      set({ lastError: "削除するオブジェクトを選択してください。" });
      return;
    }
    const nextSelectedClipId =
      clips[selectedIndex + 1]?.clip.id ?? clips[selectedIndex - 1]?.clip.id ?? "";
    const removed = get().commitCommands(
      "Remove timeline object",
      [{ type: "removeClip", clipId: selectedClipId }],
      "gui"
    );
    if (removed) set({ selectedClipId: nextSelectedClipId });
  },
  rippleRemoveSelectedClip: () => {
    const { project, selectedClipId } = get();
    const clips = allClips(project);
    if (!clips.some(({ clip }) => clip.id === selectedClipId)) {
      set({ lastError: "リップル削除するオブジェクトを選択してください。" });
      return;
    }
    const nextSelectedClipId = nextClipIdInSameTrack(project, selectedClipId);
    const removed = get().commitCommands(
      "Ripple remove timeline object",
      [{ type: "rippleRemoveClip", clipId: selectedClipId }],
      "gui"
    );
    if (removed) set({ selectedClipId: nextSelectedClipId });
  },
  duplicateSelectedClip: () => {
    const { project, selectedClipId } = get();
    const located = allClips(project).find(({ clip }) => clip.id === selectedClipId);
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
    if (added) set({ selectedClipId: duplicateId });
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
