import { describe, expect, it } from "vitest";
import { applyCommandsChecked } from "../commands";
import { emptyEffect } from "../defaults";
import { parseLlmResponseText } from "../llm";
import { migrateProject } from "../migrations";
import { ffmpegRenderer } from "../renderers/ffmpeg";
import { sampleProject } from "../sampleProject";
import { parseProjectFileJson, parseProjectJson, serializeProject, serializeProjectFile } from "../serializer";
import { validateProject } from "../validation";

describe("project core", () => {
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
