const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const assetKindFromPath = (filePath) => {
  const extension = path.extname(filePath).toLowerCase().replace(".", "");
  if (["mp3", "wav", "aac", "m4a", "flac", "ogg"].includes(extension)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)) return "image";
  return "video";
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
    title: "動画を書き出す",
    defaultPath: "movie-edit-output.mp4",
    filters: [
      { name: "MP4 Video", extensions: ["mp4"] }
    ]
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const manifest = {
    ...payload.manifest,
    outputPath: result.filePath
  };
  const manifestPath = `${result.filePath}.render.json`;
  const commandPath = `${result.filePath}.ffmpeg.cmd`;
  const commandPreview = String(manifest.commandPreview ?? "").replace(
    /"[^"]*movie-edit-output\.mp4"|"outputs\/sample-short\.mp4"/,
    `"${result.filePath}"`
  );

  await fs.writeFile(
    manifestPath,
    JSON.stringify({ manifest, projectFile: payload.projectText }, null, 2),
    "utf-8"
  );
  await fs.writeFile(commandPath, commandPreview, "utf-8");

  return {
    canceled: false,
    filePath: result.filePath,
    manifestPath,
    commandPath,
    message: `書き出し設定とFFmpegコマンドを保存しました: ${manifestPath}`
  };
});

ipcMain.handle("llm:prompt", async (_event, payload) => {
  return `LLM CLI連携の入口を受け取りました。指示: ${payload.prompt}`;
});
