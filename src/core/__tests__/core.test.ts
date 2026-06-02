import { afterEach, describe, expect, it } from "vitest";
import { applyCommandsChecked } from "../commands";
import { emptyEffect } from "../defaults";
import { parseLlmResponseText } from "../llm";
import { migrateProject } from "../migrations";
import { ffmpegRenderer } from "../renderers/ffmpeg";
import { sampleProject } from "../sampleProject";
import { parseProjectFileJson, parseProjectJson, serializeProject, serializeProjectFile } from "../serializer";
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

  it("removes the selected timeline object through the store", () => {
    useProjectStore.getState().resetSample();
    useProjectStore.getState().setSelectedClipId("cap-1");

    useProjectStore.getState().removeSelectedClip();

    const clips = useProjectStore.getState().project.tracks.flatMap((track) => track.clips);
    expect(clips.some((clip) => clip.id === "cap-1")).toBe(false);
    expect(useProjectStore.getState().selectedClipId).toBe("cap-2");
    expect(validateProject(useProjectStore.getState().project).ok).toBe(true);
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
