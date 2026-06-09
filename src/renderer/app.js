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
  targetLanguageSelect: document.querySelector("#targetLanguageSelect"),
  mizoText: document.querySelector("#mizoText"),
  scriptStats: document.querySelector("#scriptStats"),
  ttsBtn: document.querySelector("#ttsBtn"),
  timedTtsBtn: document.querySelector("#timedTtsBtn"),
  clearMizoBtn: document.querySelector("#clearMizoBtn"),
  segmentMeta: document.querySelector("#segmentMeta"),
  segmentsList: document.querySelector("#segmentsList"),
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
  segments: [],
  mediaRecorder: null,
  mediaStream: null,
  recordingChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null
};

const languages = {
  eng_Latn: { label: "English", whisper: "en" },
  zho_Hans: { label: "Chinese", whisper: "zh" },
  mya_Mymr: { label: "Myanmar", whisper: "my" },
  lus_Latn: { label: "Mizo", whisper: null }
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

function formatTimestamp(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const tenths = Math.floor((total - Math.floor(total)) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  els.logOutput.textContent = `${stamp}  ${message}\n${els.logOutput.textContent}`.slice(0, 9000);
}

function targetLanguage() {
  return els.targetLanguageSelect.value;
}

function setBusy(isBusy) {
  const hasTimedTarget = state.segments.some((segment) => (segment.targetText || segment.text || "").trim());
  els.selectVideoBtn.disabled = isBusy;
  els.extractAudioBtn.disabled = isBusy || !state.video;
  els.transcribeBtn.disabled = isBusy || !state.extractedAudioPath;
  els.translateBtn.disabled = isBusy;
  els.ttsBtn.disabled = isBusy || !state.job || !els.mizoText.value.trim();
  els.timedTtsBtn.disabled = isBusy || !state.job || !hasTimedTarget;
  els.recordBtn.disabled = isBusy || !state.job || Boolean(state.mediaRecorder);
  els.stopRecordBtn.disabled = !state.mediaRecorder;
  els.importAudioBtn.disabled = isBusy || !state.job;
  els.exportBtn.disabled = isBusy || !state.video || !state.voiceAudioPath;
  els.showOutputBtn.disabled = !state.outputPath;
}

function updateScriptStats() {
  const text = els.mizoText.value.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const segmentCount = state.segments.length;
  els.scriptStats.textContent = segmentCount > 0 ? `${words} words, ${segmentCount} timed` : `${words} words`;
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
  if (selected === "auto") {
    return "auto";
  }
  return languages[selected]?.whisper || "auto";
}

function sourceLanguageForTranslation() {
  const selected = els.sourceLanguageSelect.value;
  return selected === "auto" ? "eng_Latn" : selected;
}

function normalizeSegments(segments) {
  return (segments || [])
    .map((segment, index) => ({
      id: segment.id || `seg-${index}`,
      start: Number(segment.start) || 0,
      end: Number(segment.end) || Number(segment.start) || 0,
      text: segment.text || "",
      targetText: segment.targetText || segment.translation || ""
    }))
    .filter((segment) => segment.end > segment.start || segment.text.trim());
}

function transcriptFromSegments() {
  return state.segments.map((segment) => segment.text).filter(Boolean).join("\n");
}

function targetTextFromSegments() {
  return state.segments
    .map((segment) => segment.targetText || "")
    .filter(Boolean)
    .join("\n");
}

function renderSegments() {
  els.segmentsList.textContent = "";

  if (state.segments.length === 0) {
    els.segmentMeta.textContent = "No timed transcript yet";
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Run transcription to get timestamped segments. Pasted plain text can still use single TTS or recording, but cannot auto-sync to scenes.";
    els.segmentsList.append(empty);
    updateScriptStats();
    return;
  }

  els.segmentMeta.textContent = `${state.segments.length} segments`;
  const fragment = document.createDocumentFragment();
  state.segments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "segment-row";

    const time = document.createElement("div");
    time.className = "segment-time";
    time.textContent = `${formatTimestamp(segment.start)}\n${formatTimestamp(segment.end)}`;

    const source = document.createElement("textarea");
    source.className = "segment-text";
    source.value = segment.text;
    source.spellcheck = true;
    source.addEventListener("input", () => {
      state.segments[index].text = source.value;
      els.transcriptText.value = transcriptFromSegments();
    });

    const target = document.createElement("textarea");
    target.className = "segment-text";
    target.value = segment.targetText || "";
    target.placeholder = `${languages[targetLanguage()]?.label || "Target"} voice text`;
    target.spellcheck = true;
    target.addEventListener("input", () => {
      state.segments[index].targetText = target.value;
      els.mizoText.value = targetTextFromSegments();
      updateScriptStats();
    });

    row.append(time, source, target);
    fragment.append(row);
  });

  els.segmentsList.append(fragment);
  updateScriptStats();
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
  state.segments = [];
  els.videoPreview.src = result.fileUrl;
  els.videoMeta.textContent = `${result.name}  ${formatBytes(result.size)}`;
  els.voiceMeta.textContent = "No voice audio";
  els.exportMeta.textContent = "MP4 output";
  els.voicePreview.removeAttribute("src");
  els.transcriptText.value = "";
  els.mizoText.value = "";
  renderSegments();
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
    state.segments = normalizeSegments(result.segments);
    els.transcriptText.value = result.text || transcriptFromSegments();
    renderSegments();
    log(`Transcript loaded with ${state.segments.length} timed segments`);
  } catch (error) {
    log(`Transcription needs AI setup or a supported model: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function translateDraft() {
  const text = els.transcriptText.value.trim();
  if (!text && state.segments.length === 0) {
    log("Transcript is empty");
    return;
  }

  setBusy(true);
  try {
    if (state.segments.length > 0) {
      const result = await window.dubBridge.translateSegments({
        segments: state.segments,
        jobDir: state.job?.dir,
        sourceLanguage: sourceLanguageForTranslation(),
        targetLanguage: targetLanguage()
      });
      state.segments = normalizeSegments(result.segments);
      els.mizoText.value = targetTextFromSegments();
      renderSegments();
      log(`${languages[targetLanguage()]?.label || "Target"} timed draft loaded`);
    } else {
      const result = await window.dubBridge.translate({
        text,
        sourceLanguage: sourceLanguageForTranslation(),
        targetLanguage: targetLanguage()
      });
      els.mizoText.value = result.text || "";
      updateScriptStats();
      log(`${languages[targetLanguage()]?.label || "Target"} draft loaded`);
    }
  } catch (error) {
    log(`Translation needs AI setup: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function trySingleTts() {
  const text = els.mizoText.value.trim();
  if (!state.job || !text) {
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.synthesizeMizo({
      text,
      jobDir: state.job.dir,
      language: targetLanguage()
    });
    state.voiceAudioPath = result.path;
    els.voicePreview.src = result.fileUrl;
    els.voiceMeta.textContent = result.name;
    log("Single TTS audio ready. Use timed AI voice for better scene sync.");
  } catch (error) {
    log(`TTS unavailable: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function generateTimedAiVoice() {
  if (!state.job || state.segments.length === 0) {
    log("Timed voice needs a timestamped transcript first");
    return;
  }

  const segments = state.segments
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: (segment.targetText || segment.text || "").trim()
    }))
    .filter((segment) => segment.text && segment.end > segment.start);

  if (segments.length === 0) {
    log("Timed segments do not have target voice text");
    return;
  }

  setBusy(true);
  try {
    const result = await window.dubBridge.synthesizeSegments({
      segments,
      jobDir: state.job.dir,
      language: targetLanguage()
    });
    state.voiceAudioPath = result.path;
    els.voicePreview.src = result.fileUrl;
    els.voiceMeta.textContent = `${result.name}  timed`;
    log("Timed AI voice generated and aligned to transcript timestamps");
  } catch (error) {
    log(`Timed AI voice failed: ${error.message}`);
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
    log("Recording saved and normalized. Whole recordings are not scene-aligned unless you record to match the video.");
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

function clearTargetScript() {
  els.mizoText.value = "";
  for (const segment of state.segments) {
    segment.targetText = "";
  }
  renderSegments();
}

function targetLanguageChanged() {
  renderSegments();
  const label = languages[targetLanguage()]?.label || "target";
  log(`Target voice language set to ${label}`);
}

els.refreshToolsBtn.addEventListener("click", refreshTools);
els.selectVideoBtn.addEventListener("click", selectVideo);
els.extractAudioBtn.addEventListener("click", extractAudio);
els.transcribeBtn.addEventListener("click", transcribeAudio);
els.translateBtn.addEventListener("click", translateDraft);
els.ttsBtn.addEventListener("click", trySingleTts);
els.timedTtsBtn.addEventListener("click", generateTimedAiVoice);
els.clearMizoBtn.addEventListener("click", clearTargetScript);
els.recordBtn.addEventListener("click", startRecording);
els.stopRecordBtn.addEventListener("click", stopRecording);
els.importAudioBtn.addEventListener("click", importAudio);
els.exportBtn.addEventListener("click", exportVideo);
els.showOutputBtn.addEventListener("click", () => window.dubBridge.showFile(state.outputPath));
els.mizoText.addEventListener("input", updateScriptStats);
els.targetLanguageSelect.addEventListener("change", targetLanguageChanged);

window.dubBridge.onProgress(setProgress);
refreshTools();
renderSegments();
