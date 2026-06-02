import { afterEach, describe, expect, it } from "vitest";
import { applyCommandsChecked } from "../commands";
import { alignHorizontalPosition, alignVerticalPosition } from "../canvasAlign";
import { calculateCanvasFitScale, centerPosition } from "../canvasFit";
import { emptyEffect } from "../defaults";
import { resolveKeyboardShortcut } from "../keyboardShortcuts";
import { calculateResizeScale } from "../previewResize";
import { calculateRotation, normalizeRotation } from "../previewRotate";
import { parseLlmResponseText } from "../llm";
import { migrateProject } from "../migrations";
import { ffmpegRenderer } from "../renderers/ffmpeg";
import { sampleProject } from "../sampleProject";
import { parseProjectFileJson, parseProjectJson, serializeProject, serializeProjectFile } from "../serializer";
import { nearestTimelineBoundary, timelineBoundaryFrames } from "../timelineNavigation";
import { validateProject } from "../validation";
import { useProjectStore } from "../../store/projectStore";

describe("project core", () => {
  afterEach(() => {
    useProjectStore.getState().resetSample();
  });

  it("migrates a legacy project into the current schema", () => {
    const migrated = migrateProject({
      id: "legacy",
      name: "Legacy",
      assets: [],
      tracks: [{ id: "track-1", kind: "video", name: "Video", clips: [] }]
    });

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.tracks[0].effects).toEqual([]);
    expect(validateProject(migrated).ok).toBe(true);
  });

  it("round-trips canonical project JSON", () => {
    const parsed = parseProjectJson(serializeProject(sampleProject));

    expect(parsed).toEqual(sampleProject);
  });

  it("resolves editor keyboard shortcuts without touching unrelated keys", () => {
    expect(resolveKeyboardShortcut({ key: "z", ctrlKey: true })).toBe("undo");
    expect(resolveKeyboardShortcut({ key: "z", metaKey: true, shiftKey: true })).toBe("redo");
    expect(resolveKeyboardShortcut({ key: "y", ctrlKey: true })).toBe("redo");
    expect(resolveKeyboardShortcut({ key: "d", ctrlKey: true })).toBe("duplicate");
    expect(resolveKeyboardShortcut({ key: "k", ctrlKey: true })).toBe("split");
    expect(resolveKeyboardShortcut({ key: "Delete" })).toBe("remove");
    expect(resolveKeyboardShortcut({ key: "Backspace" })).toBe("remove");
    expect(resolveKeyboardShortcut({ key: "Delete", shiftKey: true })).toBe("rippleRemove");
    expect(resolveKeyboardShortcut({ key: "[" })).toBe("jumpSelectedStart");
    expect(resolveKeyboardShortcut({ key: "]" })).toBe("jumpSelectedEnd");
    expect(resolveKeyboardShortcut({ key: "," })).toBe("jumpPreviousBoundary");
    expect(resolveKeyboardShortcut({ key: "." })).toBe("jumpNextBoundary");
    expect(resolveKeyboardShortcut({ key: "ArrowLeft" })).toBe("stepLeft");
    expect(resolveKeyboardShortcut({ key: "ArrowRight" })).toBe("stepRight");
    expect(resolveKeyboardShortcut({ key: "ArrowLeft", shiftKey: true })).toBe("nudgeSelectedLeft");
    expect(resolveKeyboardShortcut({ key: "ArrowRight", shiftKey: true })).toBe("nudgeSelectedRight");
    expect(resolveKeyboardShortcut({ key: "d", ctrlKey: true, altKey: true })).toBeNull();
    expect(resolveKeyboardShortcut({ key: "Delete", altKey: true })).toBeNull();
    expect(resolveKeyboardShortcut({ key: "a" })).toBeNull();
  });

  it("calculates preview resize scale with corner directions and clamps", () => {
    expect(calculateResizeScale({ x: 1, y: 1 }, { x: 0.2, y: 0.1 }, { x: 1, y: 1 }, false)).toEqual({
      x: 1.4,
      y: 1.2
    });
    expect(calculateResizeScale({ x: 1, y: 1 }, { x: -0.2, y: -0.1 }, { x: -1, y: -1 }, false)).toEqual({
      x: 1.4,
      y: 1.2
    });
    const proportional = calculateResizeScale({ x: 1, y: 0.8 }, { x: 0.1, y: 0.2 }, { x: 1, y: 1 }, true);
    expect(proportional.x).toBeCloseTo(1.4);
    expect(proportional.y).toBeCloseTo(1.2);
    expect(calculateResizeScale({ x: 2.9, y: 0.2 }, { x: 1, y: -1 }, { x: 1, y: 1 }, false)).toEqual({
      x: 3,
      y: 0.1
    });
  });

  it("calculates preview rotation deltas and optional snapping", () => {
    const center = { x: 0.5, y: 0.5 };
    expect(calculateRotation(0, center, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, false)).toBeCloseTo(90);
    expect(calculateRotation(7, center, { x: 0.5, y: 0.25 }, { x: 0.75, y: 0.5 }, true)).toBe(90);
    expect(normalizeRotation(270)).toBe(-90);
    expect(normalizeRotation(-270)).toBe(90);
  });

  it("calculates canvas center and fit scales", () => {
    expect(centerPosition()).toEqual({ x: 0.5, y: 0.5 });
    expect(calculateCanvasFitScale("width", "media", { width: 1080, height: 1920 }, { width: 1920, height: 1080 }).x).toBeCloseTo(
      100 / 72
    );
    expect(calculateCanvasFitScale("height", "media", { width: 1080, height: 1920 }, { width: 1920, height: 1080 }).x).toBeCloseTo(
      100 / (72 * ((1080 / 1920) / (1920 / 1080)))
    );
    expect(calculateCanvasFitScale("height", "text", { width: 1080, height: 1920 }).x).toBeCloseTo(100 / 78);
  });

  it("calculates canvas alignment positions", () => {
    expect(alignHorizontalPosition({ x: 0.3, y: 0.4 }, "left")).toEqual({ x: 0, y: 0.4 });
    expect(alignHorizontalPosition({ x: 0.3, y: 0.4 }, "center")).toEqual({ x: 0.5, y: 0.4 });
    expect(alignHorizontalPosition({ x: 0.3, y: 0.4 }, "right")).toEqual({ x: 1, y: 0.4 });
    expect(alignVerticalPosition({ x: 0.3, y: 0.4 }, "top")).toEqual({ x: 0.3, y: 0 });
    expect(alignVerticalPosition({ x: 0.3, y: 0.4 }, "middle")).toEqual({ x: 0.3, y: 0.5 });
    expect(alignVerticalPosition({ x: 0.3, y: 0.4 }, "bottom")).toEqual({ x: 0.3, y: 1 });
  });

  it("finds previous and next timeline boundaries", () => {
    const boundaries = timelineBoundaryFrames(sampleProject);
    expect(boundaries[0]).toBe(0);
    expect(boundaries).toContain(36);
    expect(boundaries).toContain(480);
    expect(nearestTimelineBoundary(sampleProject, 100, "previous")).toBe(90);
    expect(nearestTimelineBoundary(sampleProject, 100, "next")).toBe(102);
    expect(nearestTimelineBoundary(sampleProject, 0, "previous")).toBeNull();
    expect(nearestTimelineBoundary(sampleProject, 9999, "next")).toBeNull();
    expect(timelineBoundaryFrames(sampleProject, "title-hero")).not.toContain(90);
  });

  it("keeps keyframed properties in the same schema path as static values", () => {
    const title = sampleProject.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === "title-hero");

    expect(title?.type).toBe("title");
    expect(title && "transform" in title ? title.transform.opacity.mode : "").toBe("keyframed");
    expect(validateProject(sampleProject).ok).toBe(true);
  });

  it("preserves unsupported effect nodes and warns before rendering", () => {
    const { project } = applyCommandsChecked(sampleProject, [
      {
        type: "addEffect",
        targetId: "clip-talk-1",
        effect: emptyEffect("fx-future", "future-glow", "Future Glow")
      }
    ]);
    const validation = validateProject(project);
    const plan = ffmpegRenderer.createManifest({ project, outputPath: "out.mp4" });

    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((warning) => warning.includes("future-glow"))).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("future-glow"))).toBe(true);
  });

  it("creates deterministic ffmpeg manifests from the same AST", () => {
    const first = ffmpegRenderer.createManifest({ project: sampleProject, outputPath: "out.mp4" });
    const second = ffmpegRenderer.createManifest({ project: sampleProject, outputPath: "out.mp4" });

    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest));
  });

  it("updates canvas resolution and clip transform through commands", () => {
    const { project } = applyCommandsChecked(sampleProject, [
      { type: "updateRenderSettings", render: { size: { width: 1920, height: 1080 } } },
      {
        type: "updateClipTransform",
        clipId: "clip-talk-1",
        position: { x: 0.25, y: 0.5 },
        scale: { x: 0.8, y: 0.8 },
        opacity: 0.75
      }
    ]);
    const clip = project.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === "clip-talk-1");

    expect(project.render.size).toEqual({ width: 1920, height: 1080 });
    expect(clip?.type).toBe("media");
    expect(clip && "transform" in clip && clip.transform.position.mode === "static" ? clip.transform.position.value.x : null).toBe(0.25);
    expect(clip && "transform" in clip && clip.transform.scale.mode === "static" ? clip.transform.scale.value.x : null).toBe(0.8);
    expect(clip && "transform" in clip && clip.transform.opacity.mode === "static" ? clip.transform.opacity.value : null).toBe(0.75);
  });

  it("updates text objects through the generic text command", () => {
    const { project } = applyCommandsChecked(sampleProject, [
      { type: "updateText", clipId: "title-hero", text: "Updated text object" }
    ]);
    const title = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === "title-hero");

    expect(title && "text" in title ? title.text : "").toBe("Updated text object");
  });

  it("stores text appearance metadata through the reducer", () => {
    const { project } = applyCommandsChecked(sampleProject, [
      {
        type: "updateClipMeta",
        clipId: "title-hero",
        meta: { textStyle: { fontFamily: "Yu Gothic", fontSize: 42, color: "#ffeeaa" } }
      }
    ]);
    const title = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === "title-hero");

    expect(title?.meta.textStyle).toEqual({ fontFamily: "Yu Gothic", fontSize: 42, color: "#ffeeaa" });
    expect(validateProject(project).ok).toBe(true);
  });

  it("saves project files and allows mixed object kinds on generic layers", () => {
    const moved = applyCommandsChecked(sampleProject, [
      { type: "moveClip", clipId: "clip-bgm-1", targetTrackId: "layer-1", startFrame: 480 }
    ]).project;
    const loaded = parseProjectFileJson(serializeProjectFile(moved));
    const layer1 = loaded.tracks.find((track) => track.id === "layer-1");

    expect(layer1?.clips.some((clip) => clip.id === "clip-bgm-1")).toBe(true);
    expect(validateProject(loaded).ok).toBe(true);
  });

  it("rejects overlapping objects on the same layer", () => {
    expect(() =>
      applyCommandsChecked(sampleProject, [
        { type: "moveClip", clipId: "clip-bgm-1", targetTrackId: "layer-1", startFrame: 15 }
      ])
    ).toThrow(/overlapping objects/);
  });

  it("updates layer lock and mute state through commands", () => {
    const { project } = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-1", locked: true, muted: true, solo: true }
    ]);
    const layer = project.tracks.find((track) => track.id === "layer-1");

    expect(layer?.locked).toBe(true);
    expect(layer?.muted).toBe(true);
    expect(layer?.solo).toBe(true);
    expect(validateProject(project).ok).toBe(true);
  });

  it("filters muted and soloed layers from the ffmpeg manifest", () => {
    const mutedProject = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-1", muted: true }
    ]).project;
    const mutedPlan = ffmpegRenderer.createManifest({ project: mutedProject, outputPath: "out.mp4" });

    expect(mutedPlan.manifest.segments.some((segment) => segment.trackId === "layer-1")).toBe(false);
    expect(mutedPlan.manifest.segments.some((segment) => segment.trackId === "layer-2")).toBe(true);

    const soloProject = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-2", solo: true }
    ]).project;
    const soloPlan = ffmpegRenderer.createManifest({ project: soloProject, outputPath: "out.mp4" });

    expect(soloPlan.manifest.segments.every((segment) => segment.trackId === "layer-2")).toBe(true);
  });

  it("rejects edits on locked layers through the reducer", () => {
    const lockedProject = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-1", locked: true }
    ]).project;

    expect(() =>
      applyCommandsChecked(lockedProject, [
        { type: "moveClip", clipId: "clip-talk-1", targetTrackId: "layer-5", startFrame: 300 }
      ])
    ).toThrow(/Track is locked/);
    expect(() =>
      applyCommandsChecked(lockedProject, [{ type: "trimClip", clipId: "clip-talk-1", durationFrames: 30 }])
    ).toThrow(/Track is locked/);
    expect(() =>
      applyCommandsChecked(lockedProject, [{ type: "removeClip", clipId: "clip-talk-1" }])
    ).toThrow(/Track is locked/);
  });

  it("rejects moves into locked layers and allows edits after unlocking", () => {
    const lockedTargetProject = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-5", locked: true }
    ]).project;

    expect(() =>
      applyCommandsChecked(lockedTargetProject, [
        { type: "moveClip", clipId: "clip-talk-1", targetTrackId: "layer-5", startFrame: 300 }
      ])
    ).toThrow(/Track is locked/);

    const unlockedProject = applyCommandsChecked(lockedTargetProject, [
      { type: "updateTrackState", trackId: "layer-5", locked: false }
    ]).project;
    const movedProject = applyCommandsChecked(unlockedProject, [
      { type: "moveClip", clipId: "clip-talk-1", targetTrackId: "layer-5", startFrame: 300 }
    ]).project;

    expect(movedProject.tracks.find((track) => track.id === "layer-5")?.clips.some((clip) => clip.id === "clip-talk-1")).toBe(true);
  });

  it("rejects composition clips that reference missing compositions", () => {
    const project = structuredClone(sampleProject);
    project.tracks[4].clips.push({
      id: "comp-missing",
      type: "composition",
      name: "Missing nested comp",
      compositionId: "missing-composition",
      startFrame: 0,
      durationFrames: 30,
      transform: sampleProject.tracks[0].clips[0].transform,
      effects: [],
      meta: {}
    });

    const validation = validateProject(project);

    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("missing composition"))).toBe(true);
  });

  it("reports an error instead of throwing when imported media has no free layer", () => {
    const blockedProject = structuredClone(sampleProject);
    const baseClip = blockedProject.tracks[0].clips[0];
    blockedProject.tracks = blockedProject.tracks.map((track, index) => ({
      ...track,
      clips: [
        {
          ...structuredClone(baseClip),
          id: `cover-${index}`,
          name: `Cover ${index}`,
          startFrame: 0,
          durationFrames: 300,
          sourceInFrame: 0,
          sourceDurationFrames: 300
        }
      ]
    }));
    useProjectStore.getState().loadProjectFileText(serializeProjectFile(blockedProject));
    useProjectStore.getState().setPlayheadFrame(0);

    expect(() =>
      useProjectStore.getState().importAssetFiles([{ name: "new.mp4", path: "new.mp4", kind: "video" }])
    ).not.toThrow();

    expect(useProjectStore.getState().lastError).toContain("空きレイヤー");
    expect(useProjectStore.getState().project.assets.some((asset) => asset.name === "new.mp4")).toBe(false);
  });

  it("reports an error instead of throwing when new text has no free layer", () => {
    const blockedProject = structuredClone(sampleProject);
    const baseClip = blockedProject.tracks[0].clips[0];
    blockedProject.tracks = blockedProject.tracks.map((track, index) => ({
      ...track,
      clips: [
        {
          ...structuredClone(baseClip),
          id: `text-cover-${index}`,
          name: `Text Cover ${index}`,
          startFrame: 0,
          durationFrames: 300,
          sourceInFrame: 0,
          sourceDurationFrames: 300
        }
      ]
    }));
    useProjectStore.getState().loadProjectFileText(serializeProjectFile(blockedProject));
    useProjectStore.getState().setPlayheadFrame(0);
    const clipCountBefore = useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length;

    expect(() => useProjectStore.getState().addTextAtPlayhead()).not.toThrow();

    expect(useProjectStore.getState().lastError).toContain("空きレイヤー");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length).toBe(clipCountBefore);
  });

  it("splits the selected timeline object at the playhead through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");
    useProjectStore.getState().setPlayheadFrame(120);

    useProjectStore.getState().splitSelectedClipAtPlayhead();

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    const left = clips.find((clip) => clip.id === "clip-talk-1");
    const right = clips.find((clip) => clip.id === "clip-talk-1-split-120");
    expect(left?.durationFrames).toBe(120);
    expect(right?.startFrame).toBe(120);
    expect(right?.durationFrames).toBe(120);
    expect(right?.type === "media" ? right.sourceInFrame : null).toBe(480);
    expect(useProjectStore.getState().selectedClipId).toBe("clip-talk-1-split-120");
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("reports an error when splitting outside the selected object", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");
    useProjectStore.getState().setPlayheadFrame(0);
    const clipCountBefore = useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length;

    useProjectStore.getState().splitSelectedClipAtPlayhead();

    expect(useProjectStore.getState().lastError).toContain("内側");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length).toBe(clipCountBefore);
  });

  it("splits multiple selected timeline objects at the playhead", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["clip-talk-1", "clip-bgm-1"]);
    useProjectStore.getState().setPlayheadFrame(120);

    useProjectStore.getState().splitSelectedClipAtPlayhead();

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "clip-talk-1")?.durationFrames).toBe(120);
    expect(clips.find((clip) => clip.id === "clip-bgm-1")?.durationFrames).toBe(120);
    expect(clips.some((clip) => clip.id === "clip-talk-1-split-120")).toBe(true);
    expect(clips.some((clip) => clip.id === "clip-bgm-1-split-120")).toBe(true);
    expect(useProjectStore.getState().selectedClipIds).toEqual(["clip-talk-1-split-120", "clip-bgm-1-split-120"]);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("splits only selected timeline objects that contain the playhead", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "clip-talk-1", "clip-bgm-1"]);
    useProjectStore.getState().setPlayheadFrame(120);

    useProjectStore.getState().splitSelectedClipAtPlayhead();

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.some((clip) => clip.id === "title-hero-split-120")).toBe(false);
    expect(clips.some((clip) => clip.id === "clip-talk-1-split-120")).toBe(true);
    expect(clips.some((clip) => clip.id === "clip-bgm-1-split-120")).toBe(true);
  });

  it("removes the selected timeline object through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");

    useProjectStore.getState().removeSelectedClip();

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.some((clip) => clip.id === "cap-1")).toBe(false);
    expect(useProjectStore.getState().selectedClipId).toBe("cap-2");
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("toggles multiple selected timeline objects and removes them together", () => {
    useProjectStore.getState().resetSample();

    useProjectStore.getState().toggleSelectedClipId("cap-1");
    useProjectStore.getState().toggleSelectedClipId("cap-2");

    expect(useProjectStore.getState().selectedClipIds).toEqual(["clip-talk-1", "cap-1", "cap-2"]);
    expect(useProjectStore.getState().selectedClipId).toBe("cap-2");

    useProjectStore.getState().removeSelectedClip();

    let clipIds = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    expect(clipIds).not.toContain("clip-talk-1");
    expect(clipIds).not.toContain("cap-1");
    expect(clipIds).not.toContain("cap-2");
    expect(useProjectStore.getState().selectedClipIds.length).toBe(1);

    useProjectStore.getState().undo();
    clipIds = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
    expect(clipIds).toContain("clip-talk-1");
    expect(clipIds).toContain("cap-1");
    expect(clipIds).toContain("cap-2");
  });

  it("sets multiple selected timeline objects while ignoring duplicate or missing ids", () => {
    useProjectStore.getState().resetSample();

    useProjectStore.getState().setSelectedClipIds(["cap-1", "missing", "cap-1", "clip-bgm-1"]);

    expect(useProjectStore.getState().selectedClipIds).toEqual(["cap-1", "clip-bgm-1"]);
    expect(useProjectStore.getState().selectedClipId).toBe("clip-bgm-1");
  });

  it("nudges multiple selected timeline objects together and supports undo", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);

    useProjectStore.getState().nudgeSelectedClips(1);

    let clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "title-hero")?.startFrame).toBe(1);
    expect(clips.find((clip) => clip.id === "cap-1")?.startFrame).toBe(37);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().undo();
    clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "title-hero")?.startFrame).toBe(0);
    expect(clips.find((clip) => clip.id === "cap-1")?.startFrame).toBe(36);
  });

  it("rejects nudging selected timeline objects before frame zero", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);

    useProjectStore.getState().nudgeSelectedClips(-1);

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "title-hero")?.startFrame).toBe(0);
    expect(useProjectStore.getState().lastError).toContain("左");
  });

  it("moves selected timeline objects as a group from an anchor object", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);

    useProjectStore.getState().moveSelectedClipsOnTimeline("cap-1", "layer-3", 66);

    let clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "cap-1")?.startFrame).toBe(66);
    expect(clips.find((clip) => clip.id === "title-hero")?.startFrame).toBe(30);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().undo();
    clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.find((clip) => clip.id === "cap-1")?.startFrame).toBe(36);
    expect(clips.find((clip) => clip.id === "title-hero")?.startFrame).toBe(0);
  });

  it("moves selected timeline objects across layers while preserving relative layer offsets", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().commitCommands("Prepare empty lower layers", [{ type: "removeClip", clipId: "clip-bgm-1" }], "gui");
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);

    useProjectStore.getState().moveSelectedClipsOnTimeline("title-hero", "layer-4", 30);

    const project = useProjectStore.getState().project;
    expect(project.tracks.find((track) => track.id === "layer-4")?.clips.some((clip) => clip.id === "title-hero")).toBe(true);
    expect(project.tracks.find((track) => track.id === "layer-5")?.clips.some((clip) => clip.id === "cap-1")).toBe(true);
    expect(validateProject(project).ok).toBe(true);
  });

  it("ripple-removes a clip and closes the gap on the same layer", () => {
    const { project } = applyCommandsChecked(sampleProject, [{ type: "rippleRemoveClip", clipId: "cap-1" }]);
    const captionTrack = project.tracks.find((track) => track.id === "layer-3");
    const cap2 = captionTrack?.clips.find((clip) => clip.id === "cap-2");
    const mediaClip = project.tracks[0].clips.find((clip) => clip.id === "clip-talk-1");

    expect(captionTrack?.clips.some((clip) => clip.id === "cap-1")).toBe(false);
    expect(cap2?.startFrame).toBe(72);
    expect(mediaClip?.startFrame).toBe(sampleProject.tracks[0].clips[0].startFrame);
    expect(validateProject(project).ok).toBe(true);
  });

  it("rejects ripple remove on locked layers", () => {
    const lockedProject = applyCommandsChecked(sampleProject, [
      { type: "updateTrackState", trackId: "layer-3", locked: true }
    ]).project;

    expect(() => applyCommandsChecked(lockedProject, [{ type: "rippleRemoveClip", clipId: "cap-1" }])).toThrow(
      /Track is locked/
    );
  });

  it("ripple-removes the selected timeline object through the store and supports undo", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");

    useProjectStore.getState().rippleRemoveSelectedClip();

    let cap2 = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === "cap-2");
    expect(cap2?.startFrame).toBe(72);
    expect(useProjectStore.getState().selectedClipId).toBe("cap-2");

    useProjectStore.getState().undo();
    cap2 = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === "cap-2");
    expect(cap2?.startFrame).toBe(138);
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).some((clip) => clip.id === "cap-1")).toBe(true);
  });

  it("ripple-removes multiple selected timeline objects on the same layer", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["cap-1", "cap-2"]);

    useProjectStore.getState().rippleRemoveSelectedClip();

    let captionTrack = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-3");
    expect(captionTrack?.clips).toEqual([]);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().undo();
    captionTrack = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-3");
    expect(captionTrack?.clips.some((clip) => clip.id === "cap-1")).toBe(true);
    expect(captionTrack?.clips.some((clip) => clip.id === "cap-2")).toBe(true);
  });

  it("ripple-removes multiple selected timeline objects across layers independently", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["cap-1", "clip-talk-1"]);

    useProjectStore.getState().rippleRemoveSelectedClip();

    const project = useProjectStore.getState().project;
    const captionTrack = project.tracks.find((track) => track.id === "layer-3");
    const videoTrack = project.tracks.find((track) => track.id === "layer-1");
    expect(captionTrack?.clips.some((clip) => clip.id === "cap-1")).toBe(false);
    expect(captionTrack?.clips.find((clip) => clip.id === "cap-2")?.startFrame).toBe(72);
    expect(videoTrack?.clips.some((clip) => clip.id === "clip-talk-1")).toBe(false);
    expect(videoTrack?.clips.find((clip) => clip.id === "clip-talk-2")?.startFrame).toBe(0);
    expect(validateProject(project).ok).toBe(true);
  });

  it("reports an error when ripple removing without a selected object", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("");
    const clipCountBefore = useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length;

    useProjectStore.getState().rippleRemoveSelectedClip();

    expect(useProjectStore.getState().lastError).toContain("リップル削除");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length).toBe(clipCountBefore);
  });

  it("duplicates the selected timeline object into the next free slot", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().duplicateSelectedClip();

    const layer1 = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-1");
    const duplicate = layer1?.clips.find((clip) => clip.id === useProjectStore.getState().selectedClipId);
    expect(duplicate?.id).toContain("clip-talk-1-copy-");
    expect(duplicate?.name).toBe("Talk intro copy");
    expect(duplicate?.startFrame).toBe(480);
    expect(duplicate?.durationFrames).toBe(240);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).some((clip) => clip.id === duplicate?.id)).toBe(false);
  });

  it("duplicates multiple selected timeline objects while preserving relative timing", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);

    useProjectStore.getState().duplicateSelectedClip();

    const selectedIds = useProjectStore.getState().selectedClipIds;
    expect(selectedIds).toHaveLength(2);
    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    const titleCopy = clips.find((clip) => clip.id === selectedIds[0] && clip.id !== "title-hero");
    const captionCopy = clips.find((clip) => clip.id === selectedIds[1] && clip.id !== "cap-1");
    expect(titleCopy?.startFrame).toBe(204);
    expect(captionCopy?.startFrame).toBe(240);
    expect(captionCopy && titleCopy ? captionCopy.startFrame - titleCopy.startFrame : null).toBe(36);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).some((clip) => selectedIds.includes(clip.id))).toBe(false);
  });

  it("duplicates the selected timeline object at the playhead", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");
    useProjectStore.getState().setPlayheadFrame(300);

    useProjectStore.getState().duplicateSelectedClipAtPlayhead();

    const duplicate = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === useProjectStore.getState().selectedClipId);
    expect(duplicate?.id).toContain("cap-1-copy-");
    expect(duplicate?.startFrame).toBe(300);
    expect(duplicate?.durationFrames).toBe(66);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).some((clip) => clip.id === duplicate?.id)).toBe(false);
  });

  it("duplicates multiple selected timeline objects at the playhead", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipIds(["title-hero", "cap-1"]);
    useProjectStore.getState().setPlayheadFrame(300);

    useProjectStore.getState().duplicateSelectedClipAtPlayhead();

    const selectedIds = useProjectStore.getState().selectedClipIds;
    expect(selectedIds).toHaveLength(2);
    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    const titleCopy = clips.find((clip) => clip.id === selectedIds[0] && clip.id !== "title-hero");
    const captionCopy = clips.find((clip) => clip.id === selectedIds[1] && clip.id !== "cap-1");
    expect(titleCopy?.startFrame).toBe(300);
    expect(captionCopy?.startFrame).toBe(336);
    expect(captionCopy && titleCopy ? captionCopy.startFrame - titleCopy.startFrame : null).toBe(36);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("reports an error when duplicating at the playhead would overlap", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");
    useProjectStore.getState().setPlayheadFrame(80);
    const selectedBefore = useProjectStore.getState().selectedClipId;

    useProjectStore.getState().duplicateSelectedClipAtPlayhead();

    expect(useProjectStore.getState().lastError).toContain("overlapping objects");
    expect(useProjectStore.getState().selectedClipId).toBe(selectedBefore);
  });

  it("reports errors when duplicating without a selection or on a locked layer", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("");
    const clipCountBefore = useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length;

    useProjectStore.getState().duplicateSelectedClip();

    expect(useProjectStore.getState().lastError).toContain("複製");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length).toBe(clipCountBefore);

    useProjectStore.getState().setSelectedClipId("cap-1");
    useProjectStore.getState().toggleTrackLocked("layer-3");
    useProjectStore.getState().duplicateSelectedClip();

    expect(useProjectStore.getState().lastError).toContain("ロック中");
  });

  it("reports an error when removing without a selected object", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("");
    const clipCountBefore = useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length;

    useProjectStore.getState().removeSelectedClip();

    expect(useProjectStore.getState().lastError).toContain("削除");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips).length).toBe(clipCountBefore);
  });

  it("clears selection when removing the only timeline object", () => {
    const singleClipProject = structuredClone(sampleProject);
    singleClipProject.tracks = singleClipProject.tracks.map((track, index) => ({
      ...track,
      clips: index === 0 ? [structuredClone(sampleProject.tracks[0].clips[0])] : []
    }));
    useProjectStore.getState().loadProjectFileText(serializeProjectFile(singleClipProject));
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().removeSelectedClip();

    expect(useProjectStore.getState().selectedClipId).toBe("");
    expect(useProjectStore.getState().project.tracks.flatMap((track) => track.clips)).toEqual([]);
  });

  it("edits selected object start and duration through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");

    useProjectStore.getState().setSelectedStartFrame(45);
    useProjectStore.getState().setSelectedDurationFrames(30);

    const caption = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === "cap-1");
    expect(caption?.startFrame).toBe(45);
    expect(caption?.durationFrames).toBe(30);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("rejects selected object timing edits that would overlap on the same layer", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");
    const before = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === "clip-talk-1");

    useProjectStore.getState().setSelectedStartFrame(30);

    const after = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((clip) => clip.id === "clip-talk-1");
    expect(after?.startFrame).toBe(before?.startFrame);
    expect(useProjectStore.getState().lastError).toContain("overlapping objects");
  });

  it("edits media object duration and source duration together through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().setSelectedDurationFrames(90);

    const clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip?.durationFrames).toBe(90);
    expect(clip?.type === "media" ? clip.sourceDurationFrames : null).toBe(90);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
  });

  it("trims timeline object edges through the store", () => {
    useProjectStore.getState().resetSample();

    useProjectStore.getState().trimClipOnTimeline("clip-talk-1", "start", 30);

    let clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip?.startFrame).toBe(30);
    expect(clip?.durationFrames).toBe(210);
    expect(clip?.type === "media" ? clip.sourceInFrame : null).toBe(390);
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);

    useProjectStore.getState().trimClipOnTimeline("clip-talk-1", "end", 180);

    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip?.startFrame).toBe(30);
    expect(clip?.durationFrames).toBe(150);
    expect(clip?.type === "media" ? clip.sourceDurationFrames : null).toBe(150);

    useProjectStore.getState().undo();
    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip?.durationFrames).toBe(210);
  });

  it("centers and fits the selected object to the canvas through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().centerSelectedOnCanvas();
    let clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip && "transform" in clip && clip.transform.position.mode === "static" ? clip.transform.position.value : null).toEqual({
      x: 0.5,
      y: 0.5
    });

    useProjectStore.getState().fitSelectedToCanvas("width");
    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip && "transform" in clip && clip.transform.scale.mode === "static" ? clip.transform.scale.value.x : null).toBeCloseTo(
      100 / 72
    );

    useProjectStore.getState().undo();
    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip && "transform" in clip && clip.transform.scale.mode === "static" ? clip.transform.scale.value.x : null).toBe(1);
  });

  it("aligns the selected object through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().alignSelectedHorizontally("right");
    useProjectStore.getState().alignSelectedVertically("top");

    let clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip && "transform" in clip && clip.transform.position.mode === "static" ? clip.transform.position.value : null).toEqual({
      x: 1,
      y: 0
    });

    useProjectStore.getState().undo();
    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "clip-talk-1");
    expect(clip && "transform" in clip && clip.transform.position.mode === "static" ? clip.transform.position.value : null).toEqual({
      x: 1,
      y: 0.5
    });
  });

  it("moves the selected object between adjacent layers through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-bgm-1");

    useProjectStore.getState().moveSelectedClipLayer("down");

    expect(
      useProjectStore.getState().project.tracks.find((track) => track.id === "layer-5")?.clips.some((clip) => clip.id === "clip-bgm-1")
    ).toBe(true);

    useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().project.tracks.find((track) => track.id === "layer-4")?.clips.some((clip) => clip.id === "clip-bgm-1")
    ).toBe(true);
  });

  it("moves the selected object to the playhead through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");
    useProjectStore.getState().setPlayheadFrame(0);

    useProjectStore.getState().moveSelectedClipToPlayhead();

    let clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "cap-1");
    expect(clip?.startFrame).toBe(0);

    useProjectStore.getState().undo();
    clip = useProjectStore
      .getState()
      .project.tracks.flatMap((track) => track.clips)
      .find((candidate) => candidate.id === "cap-1");
    expect(clip?.startFrame).toBe(36);
  });

  it("jumps the playhead to the selected object boundaries", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");

    useProjectStore.getState().jumpPlayheadToSelectedBoundary("start");
    expect(useProjectStore.getState().playheadFrame).toBe(36);

    useProjectStore.getState().jumpPlayheadToSelectedBoundary("end");
    expect(useProjectStore.getState().playheadFrame).toBe(102);
  });

  it("reports an error when jumping to selected object boundaries without a selection", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("");
    const playheadBefore = useProjectStore.getState().playheadFrame;

    useProjectStore.getState().jumpPlayheadToSelectedBoundary("start");

    expect(useProjectStore.getState().lastError).toContain("再生ヘッド");
    expect(useProjectStore.getState().playheadFrame).toBe(playheadBefore);
  });

  it("jumps the playhead to previous and next timeline boundaries", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setPlayheadFrame(100);

    useProjectStore.getState().jumpPlayheadToTimelineBoundary("previous");
    expect(useProjectStore.getState().playheadFrame).toBe(90);

    useProjectStore.getState().jumpPlayheadToTimelineBoundary("next");
    expect(useProjectStore.getState().playheadFrame).toBe(102);
  });

  it("reports an error when timeline boundary navigation has no target", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setPlayheadFrame(0);

    useProjectStore.getState().jumpPlayheadToTimelineBoundary("previous");

    expect(useProjectStore.getState().lastError).toContain("前の境界");
    expect(useProjectStore.getState().playheadFrame).toBe(0);
  });

  it("reports errors when moving to playhead is invalid", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("");

    useProjectStore.getState().moveSelectedClipToPlayhead();

    expect(useProjectStore.getState().lastError).toContain("再生ヘッド");

    useProjectStore.getState().setSelectedClipId("clip-talk-2");
    useProjectStore.getState().setPlayheadFrame(0);
    useProjectStore.getState().moveSelectedClipToPlayhead();

    expect(useProjectStore.getState().lastError).toContain("overlapping objects");
  });

  it("reports errors when selected object cannot move to an adjacent layer", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("clip-talk-1");

    useProjectStore.getState().moveSelectedClipLayer("up");

    expect(useProjectStore.getState().lastError).toContain("上のレイヤー");

    useProjectStore.getState().setSelectedClipId("title-hero");
    useProjectStore.getState().moveSelectedClipLayer("up");

    expect(useProjectStore.getState().lastError).toContain("overlapping objects");
  });

  it("toggles layer lock, mute, and solo through the store history", () => {
    useProjectStore.getState().resetSample();

    useProjectStore.getState().toggleTrackLocked("layer-1");
    useProjectStore.getState().toggleTrackMuted("layer-1");
    useProjectStore.getState().toggleTrackSolo("layer-1");

    let layer = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-1");
    expect(layer?.locked).toBe(true);
    expect(layer?.muted).toBe(true);
    expect(layer?.solo).toBe(true);

    useProjectStore.getState().undo();
    layer = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-1");
    expect(layer?.locked).toBe(true);
    expect(layer?.muted).toBe(true);
    expect(layer?.solo).toBe(false);

    useProjectStore.getState().redo();
    layer = useProjectStore.getState().project.tracks.find((track) => track.id === "layer-1");
    expect(layer?.locked).toBe(true);
    expect(layer?.muted).toBe(true);
    expect(layer?.solo).toBe(true);
  });

  it("runs GUI and LLM operations through the same reducer contract", () => {
    const llmText = JSON.stringify({
      message: "字幕を追加します。",
      operations: [
        {
          type: "add_caption",
          trackId: "layer-5",
          at: "00:00:06.000",
          duration: "00:00:02.000",
          text: "LLM command"
        }
      ]
    });
    const { commands } = parseLlmResponseText(llmText, sampleProject);
    if (commands[0].type !== "addClip") {
      throw new Error("Expected LLM add_caption to become addClip.");
    }
    const llmApplied = applyCommandsChecked(sampleProject, commands);
    const guiApplied = applyCommandsChecked(sampleProject, [commands[0]]);

    expect(llmApplied.project.tracks.find((track) => track.id === "layer-5")?.clips.length).toBe(
      guiApplied.project.tracks.find((track) => track.id === "layer-5")?.clips.length
    );
  });
});
