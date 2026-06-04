import type { ProjectAst } from "../types";

export type RenderExportKind = "video" | "audio-mp3" | "audio-wav";

export interface RenderRequest {
  project: ProjectAst;
  outputPath: string;
  exportKind?: RenderExportKind;
  range?: {
    startFrame: number;
    durationFrames: number;
  };
}

export interface RenderPlan<TManifest> {
  rendererId: string;
  manifest: TManifest;
  warnings: string[];
}

export interface Renderer<TManifest> {
  id: string;
  name: string;
  createManifest(request: RenderRequest): RenderPlan<TManifest>;
}
