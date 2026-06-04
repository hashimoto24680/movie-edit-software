const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const assetKindFromPath = (filePath) => {
  const extension = path.extname(filePath).toLowerCase().replace(".", "");
  if (["mp3", "wav", "aac", "m4a", "flac", "ogg"].includes(extension)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)) return "image";
  return "video";
};

const commandPreviewWithOutputPath = (manifest, outputPath) => {
  const commandPreview = String(manifest?.commandPreview ?? "");
  const previousOutputPath = typeof manifest?.outputPath === "string" ? manifest.outputPath : "";
  const quotedOutputPath = `"${outputPath}"`;
  if (!commandPreview) return "";
  if (previousOutputPath) {
    const quotedPreviousPath = `"${previousOutputPath}"`;
    if (commandPreview.includes(quotedPreviousPath)) {
      return commandPreview.split(quotedPreviousPath).join(quotedOutputPath);
    }
  }
  return commandPreview.replace(/"[^"]*"\s*$/, () => quotedOutputPath);
};

const writeFfmpegExportFiles = async (filePath, payload) => {
  const commandPreview = commandPreviewWithOutputPath(payload.manifest, filePath);
  const manifest = {
    ...payload.manifest,
    outputPath: filePath,
    commandPreview
  };
  const manifestPath = `${filePath}.render.json`;
  const commandPath = `${filePath}.ffmpeg.cmd`;

  await fs.writeFile(
    manifestPath,
    JSON.stringify({ manifest, projectFile: payload.projectText }, null, 2),
    "utf-8"
  );
  await fs.writeFile(commandPath, commandPreview, "utf-8");

  return { manifestPath, commandPath };
};

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Movie Edit Software",
    backgroundColor: "#111418",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
};

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("project:save", async (_event, text) => {
  const result = await dialog.showSaveDialog({
    title: "プロジェクトを保存",
    defaultPath: "movie-edit-project.mesproj",
    filters: [
      { name: "Movie Edit Project", extensions: ["mesproj"] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, text, "utf-8");
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "プロジェクトを開く",
    filters: [
      { name: "Movie Edit Project", extensions: ["mesproj"] }
    ],
    properties: ["openFile"]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return fs.readFile(result.filePaths[0], "utf-8");
});

ipcMain.handle("asset:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "素材を読み込む",
    filters: [
      { name: "Media files", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "png", "jpg", "jpeg", "webp", "gif", "bmp", "wav", "mp3", "aac", "m4a", "flac", "ogg"] },
      { name: "Video", extensions: ["mp4", "mov", "m4v", "webm", "mkv", "avi"] },
      { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
      { name: "Audio", extensions: ["wav", "mp3", "aac", "m4a", "flac", "ogg"] }
    ],
    properties: ["openFile", "multiSelections"]
  });

  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    kind: assetKindFromPath(filePath)
  }));
});

ipcMain.handle("video:export", async (_event, payload) => {
  const result = await dialog.showSaveDialog({
    title: "MP4動画を書き出す",
    defaultPath: "movie-edit-output.mp4",
    filters: [
      { name: "MP4 Video", extensions: ["mp4"] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const { manifestPath, commandPath } = await writeFfmpegExportFiles(result.filePath, payload);

  return {
    canceled: false,
    filePath: result.filePath,
    manifestPath,
    commandPath,
    message: `書き出し設定とFFmpegコマンドを保存しました: ${manifestPath}`
  };
});

ipcMain.handle("audio:export", async (_event, payload) => {
  const format = payload.format === "wav" ? "wav" : "mp3";
  const result = await dialog.showSaveDialog({
    title: `${format.toUpperCase()}音声を書き出す`,
    defaultPath: `movie-edit-output.${format}`,
    filters: [
      { name: `${format.toUpperCase()} Audio`, extensions: [format] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const { manifestPath, commandPath } = await writeFfmpegExportFiles(result.filePath, payload);

  return {
    canceled: false,
    filePath: result.filePath,
    manifestPath,
    commandPath,
    message: `${format.toUpperCase()}書き出し設定とFFmpegコマンドを保存しました: ${manifestPath}`
  };
});

ipcMain.handle("frame:export", async (event, payload) => {
  const safeTimecode = String(payload.timecode ?? "frame").replace(/[^a-zA-Z0-9.-]+/g, "-");
  const result = await dialog.showSaveDialog({
    title: "現在フレームを画像で書き出す",
    defaultPath: `movie-edit-frame-${safeTimecode}.png`,
    filters: [
      { name: "PNG Image", extensions: ["png"] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error("書き出し対象のウィンドウが見つかりません。");
  }

  const rect = payload.rect ?? {};
  const image = await window.capturePage({
    x: Math.max(0, Math.round(Number(rect.x) || 0)),
    y: Math.max(0, Math.round(Number(rect.y) || 0)),
    width: Math.max(1, Math.round(Number(rect.width) || 1)),
    height: Math.max(1, Math.round(Number(rect.height) || 1))
  });
  await fs.writeFile(result.filePath, image.toPNG());

  return {
    canceled: false,
    filePath: result.filePath,
    message: `現在フレームをPNGで保存しました: ${result.filePath}`
  };
});

ipcMain.handle("llm:prompt", async (_event, payload) => {
  return `LLM CLI連携の入口を受け取りました。指示: ${payload.prompt}`;
});
