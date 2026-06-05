const els = {
  ffmpegStatus: document.querySelector("#ffmpegStatus"),
  toolStatusText: document.querySelector("#toolStatusText"),
  refreshToolsBtn: document.querySelector("#refreshToolsBtn"),
  selectVideoBtn: document.querySelector("#selectVideoBtn"),
  videoMeta: document.querySelector("#videoMeta"),
  videoPreview: document.querySelector("#videoPreview"),
  extractAudioBtn: document.querySelector("#extractAudioBtn"),
  transcribeBtn: document.querySelector("#transcribeBtn"),
  sourceLanguageSelect: document.querySelector("#sourceLanguageSelect"),
  transcriptText: document.querySelector("#transcriptText"),
  whisperModelSelect: document.querySelector("#whisperModelSelect"),
  translateBtn: document.querySelector("#translateBtn"),
  mizoText: document.querySelector("#mizoText"),
  scriptStats: document.querySelector("#scriptStats"),
  ttsBtn: document.querySelector("#ttsBtn"),
  clearMizoBtn: document.querySelector("#clearMizoBtn"),
  voiceMeta: document.querySelector("#voiceMeta"),
  recordPulse: document.querySelector("#recordPulse"),
  recordingTime: document.querySelector("#recordingTime"),
  recordBtn: document.querySelector("#recordBtn"),
  stopRecordBtn: document.querySelector("#stopRecordBtn"),
  importAudioBtn: document.querySelector("#importAudioBtn"),
  voicePreview: document.querySelector("#voicePreview"),
  currentStep: document.querySelector("#currentStep"),
  progressFill: document.querySelector("#progressFill"),
  logOutput: document.querySelector("#logOutput"),
  exportMeta: document.querySelector("#exportMeta"),
  exportBtn: document.querySelector("#exportBtn"),
  showOutputBtn: document.querySelector("#showOutputBtn")
};

const state = {
  video: null,
  job: null,
  extractedAudioPath: null,
  voiceAudioPath: null,
  outputPath: null,
  mediaRecorder: null,
  mediaStream: null,
  recordingChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null
};

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  els.logOutput.textContent = `${stamp}  ${message}\n${els.logOutput.textContent}`.slice(0, 9000);
}

function setBusy(isBusy) {
  els.selectVideoBtn.disabled = isBusy;
  els.extractAudioBtn.disabled = isBusy || !state.video;
  els.transcribeBtn.disabled = isBusy || !state.extractedAudioPath;
  els.translateBtn.disabled = isBusy;
  els.ttsBtn.disabled = isBusy || !state.job || !els.mizoText.value.trim();
  els.recordBtn.disabled = isBusy || !state.job || Boolean(state.mediaRecorder);
  els.stopRecordBtn.disabled = !state.mediaRecorder;
  els.importAudioBtn.disabled = isBusy || !state.job;
  els.exportBtn.disabled = isBusy || !state.video || !state.voiceAudioPath;
  els.showOutputBtn.disabled = !state.outputPath;
}

function updateScriptStats() {
  const words = els.mizoText.value.trim().split(/\s+/).filter(Boolean).length;
  els.scriptStats.textContent = `${words} word${words === 1 ? "" : "s"}`;
  setBusy(false);
}

function setProgress(payload) {
  const percent = Number.isFinite(payload.percent) ? payload.percent : 0;
  els.currentStep.textContent = payload.message || payload.step || "Working";
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;

  for (const pill of document.querySelectorAll(".step-pill")) {
    if (pill.dataset.step === payload.step) {
      pill.classList.remove("running", "done", "error");
      pill.classList.add(payload.state || "running");
    }
  }

  if (payload.message) {
    log(payload.message);
  }
}

function sourceLanguageForTranscription() {
  const selected = els.sourceLanguageSelect.value;
  if (selected === "eng_Latn") {
    return "en";
  }
  if (selected === "zho_Hans") {
    return "zh";
  }
  return "auto";
}

function sourceLanguageForTranslation() {
  const selected = els.sourceLanguageSelect.value;
  if (selected === "zho_Hans") {
    return "zho_Hans";
  }
  return "eng_Latn";
}

async function refreshTools() {
  try {
    const tools = await window.dubBridge.checkTools();
    if (tools.ffmpeg.ok && tools.ffprobe.ok) {
      els.ffmpegStatus.className = "status-dot ready";
      els.toolStatusText.textContent = tools.ai.ok ? "FFmpeg and AI helpers ready" : "FFmpeg ready, AI helpers optional";
    } else {
      els.ffmpegStatus.className = "status-dot error";
      els.toolStatusText.textContent = "FFmpeg or FFprobe missing";
    }
    log(`Tools: ${tools.ffmpeg.version}; ${tools.python.version}; ${tools.ai.version}`);
  } catch (error) {
    els.ffmpegStatus.className = "status-dot error";
    els.toolStatusText.textContent = "Tool check failed";
    log(error.message);
  }
}

async function selectVideo() {
  const result = await window.dubBridge.selectVideo();
  if (!result) {
    return;
  }

  state.video = result;
  state.job = result.job;
  state.extractedAudioPath = null;
  state.voiceAudioPath = null;
  state.outputPath = null;
  els.videoPreview.src = result.fileUrl;
  els.videoMeta.textContent = `${result.name}  ${formatBytes(result.size)}`;
  els.voiceMeta.textContent = "No Mizo voice audio";
  els.exportMeta.textContent = "MP4 output";
  els.voicePreview.removeAttribute("src");
  log(`Selected video: ${result.name}`);
  setBusy(false);
}

async function extractAudio() {
  if (!state.video || !state.job) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.extractAudio({
      videoPath: state.video.path,
      jobDir: state.job.dir
    });
    state.extractedAudioPath = result.path;
    log(`Audio extracted: ${result.path}`);
  } catch (error) {
    log(`Extract failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function transcribeAudio() {
  if (!state.extractedAudioPath) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.transcribe({
      audioPath: state.extractedAudioPath,
      language: sourceLanguageForTranscription(),
      model: els.whisperModelSelect.value
    });
    els.transcriptText.value = result.text || "";
    log("Transcript loaded");
  } catch (error) {
    log(`Transcription needs AI setup: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function translateDraft() {
  const text = els.transcriptText.value.trim();
  if (!text) {
    log("Transcript is empty");
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.translate({
      text,
      sourceLanguage: sourceLanguageForTranslation()
    });
    els.mizoText.value = result.text || "";
    updateScriptStats();
    log("Mizo draft loaded");
  } catch (error) {
    log(`Translation needs AI setup: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function tryMizoTts() {
  const text = els.mizoText.value.trim();
  if (!state.job || !text) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.synthesizeMizo({
      text,
      jobDir: state.job.dir
    });
    state.voiceAudioPath = result.path;
    els.voicePreview.src = result.fileUrl;
    els.voiceMeta.textContent = result.name;
    log("Mizo TTS audio ready");
  } catch (error) {
    log(`Mizo TTS unavailable: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function startRecording() {
  if (!state.job) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const recorder = new MediaRecorder(stream, { mimeType });

    state.mediaStream = stream;
    state.mediaRecorder = recorder;
    state.recordingChunks = [];
    state.recordingStartedAt = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.recordingChunks.push(event.data);
      }
    };

    recorder.onstop = saveStoppedRecording;
    recorder.start(500);
    els.recordPulse.classList.add("active");
    els.recordingTime.textContent = "00:00";
    state.recordingTimer = window.setInterval(() => {
      els.recordingTime.textContent = formatTime((Date.now() - state.recordingStartedAt) / 1000);
    }, 500);
    log("Recording started");
    setBusy(false);
  } catch (error) {
    log(`Microphone unavailable: ${error.message}`);
    setBusy(false);
  }
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.stop();
  }
}

async function saveStoppedRecording() {
  window.clearInterval(state.recordingTimer);
  els.recordPulse.classList.remove("active");

  for (const track of state.mediaStream?.getTracks() || []) {
    track.stop();
  }

  const recorder = state.mediaRecorder;
  const blob = new Blob(state.recordingChunks, { type: recorder.mimeType || "audio/webm" });
  state.mediaRecorder = null;
  state.mediaStream = null;
  state.recordingChunks = [];
  setBusy(true);

  try {
    const previewUrl = URL.createObjectURL(blob);
    els.voicePreview.src = previewUrl;
    const arrayBuffer = await blob.arrayBuffer();
    const result = await window.dubBridge.saveRecording({
      jobDir: state.job.dir,
      arrayBuffer,
      mimeType: blob.type
    });
    state.voiceAudioPath = result.path;
    els.voiceMeta.textContent = `${result.name}  ${formatTime(result.durationSeconds || 0)}`;
    log("Recording saved and normalized");
  } catch (error) {
    log(`Recording save failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function importAudio() {
  if (!state.job) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.selectAudio(state.job.dir);
    if (result) {
      state.voiceAudioPath = result.path;
      els.voicePreview.src = result.fileUrl;
      els.voiceMeta.textContent = result.name;
      log(`Imported voice audio: ${result.name}`);
    }
  } catch (error) {
    log(`Audio import failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function exportVideo() {
  if (!state.video || !state.voiceAudioPath) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.exportVideo({
      videoPath: state.video.path,
      audioPath: state.voiceAudioPath
    });
    if (result) {
      state.outputPath = result.path;
      els.exportMeta.textContent = result.name;
      log(`Exported: ${result.path}`);
    }
  } catch (error) {
    log(`Export failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function clearMizo() {
  els.mizoText.value = "";
  updateScriptStats();
}

els.refreshToolsBtn.addEventListener("click", refreshTools);
els.selectVideoBtn.addEventListener("click", selectVideo);
els.extractAudioBtn.addEventListener("click", extractAudio);
els.transcribeBtn.addEventListener("click", transcribeAudio);
els.translateBtn.addEventListener("click", translateDraft);
els.ttsBtn.addEventListener("click", tryMizoTts);
els.clearMizoBtn.addEventListener("click", clearMizo);
els.recordBtn.addEventListener("click", startRecording);
els.stopRecordBtn.addEventListener("click", stopRecording);
els.importAudioBtn.addEventListener("click", importAudio);
els.exportBtn.addEventListener("click", exportVideo);
els.showOutputBtn.addEventListener("click", () => window.dubBridge.showFile(state.outputPath));
els.mizoText.addEventListener("input", updateScriptStats);

window.dubBridge.onProgress(setProgress);
refreshTools();
updateScriptStats();
