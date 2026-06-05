const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dubBridge", {
  checkTools: () => ipcRenderer.invoke("tools:check"),
  selectVideo: () => ipcRenderer.invoke("video:select"),
  selectAudio: (jobDir) => ipcRenderer.invoke("audio:select", jobDir),
  extractAudio: (payload) => ipcRenderer.invoke("audio:extract", payload),
  saveRecording: (payload) => ipcRenderer.invoke("recording:save", payload),
  transcribe: (payload) => ipcRenderer.invoke("ai:transcribe", payload),
  translate: (payload) => ipcRenderer.invoke("ai:translate", payload),
  synthesizeMizo: (payload) => ipcRenderer.invoke("ai:tts", payload),
  exportVideo: (payload) => ipcRenderer.invoke("video:export", payload),
  showFile: (filePath) => ipcRenderer.invoke("file:show", filePath),
  onProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pipeline-progress", listener);
    return () => ipcRenderer.removeListener("pipeline-progress", listener);
  }
});
