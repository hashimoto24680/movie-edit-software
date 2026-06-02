import type { ProjectAst } from "../types";

export interface RenderRequest {
  project: ProjectAst;
  outputPath: string;
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
