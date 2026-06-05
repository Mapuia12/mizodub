const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const fs = require("fs/promises");

const {
  checkTools,
  createJob,
  extractAudio,
  exportDubbedVideo,
  normalizeAudio,
  runPythonHelper,
  saveRecording
} = require("./pipeline");

let mainWindow;

function sendProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pipeline-progress", payload);
  }
}

function asFileResult(filePath, extra = {}) {
  return {
    path: filePath,
    fileUrl: pathToFileURL(filePath).href,
    name: path.basename(filePath),
    ...extra
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f5f6f8",
    title: "Mizo Dub Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("tools:check", async () => {
  return checkTools(path.resolve(__dirname, "../.."));
});

ipcMain.handle("video:select", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select recap video",
    properties: ["openFile"],
    filters: [
      { name: "Video files", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  const job = await createJob(app.getPath("userData"), filePath);
  return asFileResult(filePath, {
    size: stat.size,
    job
  });
});

ipcMain.handle("audio:select", async (_event, jobDir) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Mizo voice audio",
    properties: ["openFile"],
    filters: [
      { name: "Audio files", extensions: ["wav", "mp3", "m4a", "aac", "webm", "ogg", "flac"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  if (jobDir) {
    const normalized = await normalizeAudio({
      inputPath: filePath,
      jobDir,
      name: "imported-mizo-voice",
      sendProgress
    });
    return asFileResult(normalized.path, { sourcePath: filePath });
  }

  return asFileResult(filePath);
});

ipcMain.handle("audio:extract", async (_event, { videoPath, jobDir }) => {
  return extractAudio({ videoPath, jobDir, sendProgress });
});

ipcMain.handle("recording:save", async (_event, { jobDir, arrayBuffer, mimeType }) => {
  const bytes = Buffer.from(arrayBuffer);
  const result = await saveRecording({
    jobDir,
    bytes,
    mimeType,
    sendProgress
  });
  return asFileResult(result.normalizedPath, {
    rawPath: result.rawPath,
    durationSeconds: result.durationSeconds
  });
});

ipcMain.handle("ai:transcribe", async (_event, { audioPath, language, model }) => {
  const projectRoot = path.resolve(__dirname, "../..");
  const outputPath = path.join(path.dirname(audioPath), "transcript.json");
  const result = await runPythonHelper({
    projectRoot,
    scriptName: "transcribe.py",
    args: [
      "--audio",
      audioPath,
      "--language",
      language || "auto",
      "--model",
      model || "small",
      "--output",
      outputPath
    ],
    step: "transcribe",
    sendProgress
  });
  return result;
});

ipcMain.handle("ai:translate", async (_event, { text, sourceLanguage, model }) => {
  const projectRoot = path.resolve(__dirname, "../..");
  const tempDir = path.join(app.getPath("userData"), "tmp");
  await fs.mkdir(tempDir, { recursive: true });
  const inputPath = path.join(tempDir, `translate-${Date.now()}.txt`);
  const outputPath = path.join(tempDir, `translate-${Date.now()}.json`);
  await fs.writeFile(inputPath, text || "", "utf8");

  return runPythonHelper({
    projectRoot,
    scriptName: "translate_mizo.py",
    args: [
      "--input",
      inputPath,
      "--source-language",
      sourceLanguage || "eng_Latn",
      "--model",
      model || "facebook/nllb-200-distilled-600M",
      "--output",
      outputPath
    ],
    step: "translate",
    sendProgress
  });
});

ipcMain.handle("ai:tts", async (_event, { text, jobDir, model }) => {
  const projectRoot = path.resolve(__dirname, "../..");
  const inputPath = path.join(jobDir, "mizo-script.txt");
  const outputPath = path.join(jobDir, "mizo-tts.wav");
  await fs.writeFile(inputPath, text || "", "utf8");

  const result = await runPythonHelper({
    projectRoot,
    scriptName: "tts_mizo.py",
    args: [
      "--input",
      inputPath,
      "--model",
      model || "andrewbawitlung/SpeechT5-Mizo-Lus-v24.11.19",
      "--output",
      outputPath
    ],
    step: "tts",
    sendProgress
  });

  const normalized = await normalizeAudio({
    inputPath: outputPath,
    jobDir,
    name: "mizo-tts-normalized",
    sendProgress
  });

  return asFileResult(normalized.path, {
    tts: result
  });
});

ipcMain.handle("video:export", async (_event, { videoPath, audioPath, outputPath }) => {
  let target = outputPath;
  if (!target) {
    const save = await dialog.showSaveDialog(mainWindow, {
      title: "Save dubbed video",
      defaultPath: "mizo-dubbed-recap.mp4",
      filters: [{ name: "MP4 video", extensions: ["mp4"] }]
    });
    if (save.canceled || !save.filePath) {
      return null;
    }
    target = save.filePath;
  }

  const result = await exportDubbedVideo({
    videoPath,
    audioPath,
    outputPath: target,
    sendProgress
  });

  return asFileResult(result.outputPath);
});

ipcMain.handle("file:show", async (_event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
  return true;
});
