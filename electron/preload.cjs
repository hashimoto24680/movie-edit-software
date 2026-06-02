const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopProject", {
  saveProject: (text) => ipcRenderer.invoke("project:save", text),
  openProject: () => ipcRenderer.invoke("project:open"),
  openAssetFiles: () => ipcRenderer.invoke("asset:open"),
  exportVideo: (payload) => ipcRenderer.invoke("video:export", payload),
  sendLlmPrompt: (payload) => ipcRenderer.invoke("llm:prompt", payload)
});
