type ImportedAssetKind = "video" | "audio" | "image";

interface ImportedAssetFile {
  name: string;
  path: string;
  kind: ImportedAssetKind;
  durationFrames?: number;
  width?: number;
  height?: number;
  sampleRate?: number;
}

interface DesktopProjectApi {
  saveProject: (text: string) => Promise<{ canceled: boolean; filePath?: string }>;
  openProject: () => Promise<string | null>;
  openAssetFiles?: () => Promise<ImportedAssetFile[]>;
  exportVideo?: (payload: {
    manifest: unknown;
    projectText: string;
  }) => Promise<{
    canceled: boolean;
    filePath?: string;
    manifestPath?: string;
    commandPath?: string;
    message?: string;
  }>;
  exportAudio?: (payload: {
    format: "mp3" | "wav";
    manifest: unknown;
    projectText: string;
  }) => Promise<{
    canceled: boolean;
    filePath?: string;
    manifestPath?: string;
    commandPath?: string;
    message?: string;
  }>;
  exportFrameImage?: (payload: {
    rect: { x: number; y: number; width: number; height: number };
    frame: number;
    timecode: string;
  }) => Promise<{
    canceled: boolean;
    filePath?: string;
    message?: string;
  }>;
  sendLlmPrompt?: (payload: { prompt: string; projectText: string }) => Promise<string>;
}

interface Window {
  desktopProject?: DesktopProjectApi;
}
