const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "video";
}

function parseFfmpegTime(value) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      options.onStdout?.(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code, stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `${command} exited with code ${code}`;
      const error = new Error(detail);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function resolvePython(projectRoot) {
  const venvPython = path.join(projectRoot, ".venv-ai", "Scripts", "python.exe");
  return fsSync.existsSync(venvPython) ? venvPython : "python";
}

async function commandVersion(command, args) {
  try {
    const result = await runCommand(command, args, { allowFailure: true });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      ok: result.code === 0,
      version: output.split(/\r?\n/)[0] || "Installed"
    };
  } catch (error) {
    return {
      ok: false,
      version: error.message
    };
  }
}

async function checkTools(projectRoot) {
  const pythonCommand = resolvePython(projectRoot);
  const [ffmpeg, ffprobe, python] = await Promise.all([
    commandVersion("ffmpeg", ["-version"]),
    commandVersion("ffprobe", ["-version"]),
    commandVersion(pythonCommand, ["--version"])
  ]);

  const ai = await commandVersion(pythonCommand, [
    "-c",
    "import faster_whisper, transformers; print('AI helpers ready')"
  ]);

  return {
    projectRoot,
    ffmpeg,
    ffprobe,
    python,
    ai: {
      ok: ai.ok,
      version: ai.ok ? ai.version : "Optional AI packages are not installed yet"
    }
  };
}

async function createJob(userDataDir, videoPath) {
  const base = slugify(path.basename(videoPath, path.extname(videoPath)));
  const id = `${Date.now()}-${base}-${crypto.randomBytes(3).toString("hex")}`;
  const dir = path.join(userDataDir, "jobs", id);
  await fs.mkdir(dir, { recursive: true });
  return {
    id,
    dir,
    sourceVideo: videoPath
  };
}

async function probeDuration(inputPath) {
  try {
    const result = await runCommand("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath
    ]);
    const duration = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(duration) ? duration : null;
  } catch {
    return null;
  }
}

function progressParser({ step, durationSeconds, sendProgress }) {
  let buffered = "";
  return (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";

    for (const line of lines) {
      const [key, value] = line.split("=");
      if (!key || !value) {
        continue;
      }

      let currentSeconds = null;
      if (key === "out_time") {
        currentSeconds = parseFfmpegTime(value);
      } else if (key === "out_time_ms" || key === "out_time_us") {
        const raw = Number(value);
        currentSeconds = Number.isFinite(raw) ? raw / 1000000 : null;
      }

      if (currentSeconds != null && durationSeconds) {
        const percent = Math.max(0, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100)));
        sendProgress({
          step,
          state: "running",
          percent,
          message: `${step} ${percent}%`
        });
      }
    }
  };
}

async function runFfmpeg(args, { step, inputPath, sendProgress }) {
  const durationSeconds = inputPath ? await probeDuration(inputPath) : null;
  sendProgress({
    step,
    state: "running",
    percent: 1,
    message: `${step} started`
  });

  await runCommand("ffmpeg", ["-hide_banner", "-y", "-progress", "pipe:1", "-nostats", ...args], {
    onStdout: progressParser({ step, durationSeconds, sendProgress })
  });

  sendProgress({
    step,
    state: "done",
    percent: 100,
    message: `${step} finished`
  });
}

async function extractAudio({ videoPath, jobDir, sendProgress }) {
  await fs.mkdir(jobDir, { recursive: true });
  const outputPath = path.join(jobDir, "source-narration.wav");
  await runFfmpeg(
    [
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-acodec",
      "pcm_s16le",
      outputPath
    ],
    { step: "extract", inputPath: videoPath, sendProgress }
  );
  return {
    path: outputPath,
    durationSeconds: await probeDuration(outputPath)
  };
}

async function normalizeAudio({ inputPath, jobDir, name, sendProgress }) {
  await fs.mkdir(jobDir, { recursive: true });
  const outputPath = path.join(jobDir, `${name}.m4a`);
  await runFfmpeg(
    [
      "-i",
      inputPath,
      "-vn",
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ],
    { step: "voice", inputPath, sendProgress }
  );
  return {
    path: outputPath,
    durationSeconds: await probeDuration(outputPath)
  };
}

async function saveRecording({ jobDir, bytes, mimeType, sendProgress }) {
  await fs.mkdir(jobDir, { recursive: true });
  const extension = mimeType && mimeType.includes("wav") ? "wav" : "webm";
  const rawPath = path.join(jobDir, `mizo-recording.${extension}`);
  await fs.writeFile(rawPath, bytes);

  const normalized = await normalizeAudio({
    inputPath: rawPath,
    jobDir,
    name: "mizo-recording-normalized",
    sendProgress
  });

  return {
    rawPath,
    normalizedPath: normalized.path,
    durationSeconds: normalized.durationSeconds
  };
}

async function exportDubbedVideo({ videoPath, audioPath, outputPath, sendProgress }) {
  await runFfmpeg(
    [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { step: "export", inputPath: videoPath, sendProgress }
  );

  return { outputPath };
}

function atempoChain(inputDuration, targetDuration) {
  if (!inputDuration || !targetDuration || inputDuration <= 0 || targetDuration <= 0) {
    return [];
  }

  let tempo = inputDuration / targetDuration;
  if (Math.abs(tempo - 1) < 0.04) {
    return [];
  }

  const filters = [];
  while (tempo > 2) {
    filters.push("atempo=2");
    tempo /= 2;
  }
  while (tempo < 0.5) {
    filters.push("atempo=0.5");
    tempo /= 0.5;
  }
  filters.push(`atempo=${tempo.toFixed(3)}`);
  return filters;
}

function seconds(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function composeTimedVoiceTrack({ manifestPath, outputPath, sendProgress }) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const rawSegments = Array.isArray(manifest.segments) ? manifest.segments : [];
  const segments = rawSegments
    .map((segment, index) => ({
      ...segment,
      index,
      audioPath: segment.audioPath || segment.path,
      start: Math.max(0, seconds(segment.start)),
      end: Math.max(0, seconds(segment.end))
    }))
    .filter((segment) => segment.audioPath && segment.end > segment.start);

  if (segments.length === 0) {
    throw new Error("No timed TTS segments were generated");
  }

  const inputs = [];
  const filters = [];
  const labels = [];

  sendProgress({
    step: "align",
    state: "running",
    percent: 5,
    message: "Building timed voice track"
  });

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    inputs.push("-i", segment.audioPath);
    const inputDuration = await probeDuration(segment.audioPath);
    const targetDuration = Math.max(0.12, segment.end - segment.start);
    const delayMs = Math.round(segment.start * 1000);
    const tempo = atempoChain(inputDuration, targetDuration);
    const perSegment = [
      "aresample=48000",
      "asetpts=PTS-STARTPTS",
      ...tempo,
      `apad=pad_dur=${targetDuration.toFixed(3)}`,
      `atrim=0:${targetDuration.toFixed(3)}`,
      `adelay=${delayMs}:all=1`
    ];
    const label = `a${index}`;
    filters.push(`[${index}:a]${perSegment.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  }

  const mixedLabel = "voiceout";
  if (labels.length === 1) {
    filters.push(`${labels[0]}loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[${mixedLabel}]`);
  } else {
    filters.push(
      `${labels.join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[${mixedLabel}]`
    );
  }

  await runFfmpeg(
    [
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${mixedLabel}]`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ],
    { step: "align", inputPath: segments[segments.length - 1].audioPath, sendProgress }
  );

  return {
    outputPath,
    segments
  };
}

async function runPythonHelper({ projectRoot, scriptName, args, step, sendProgress }) {
  const scriptPath = path.join(projectRoot, "tools", "python", scriptName);
  const pythonCommand = resolvePython(projectRoot);
  sendProgress({
    step,
    state: "running",
    percent: 5,
    message: `${step} helper started`
  });

  try {
    const result = await runCommand(pythonCommand, [scriptPath, ...args], {
      cwd: projectRoot,
      onStdout: (text) => {
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) {
            continue;
          }
          try {
            const event = JSON.parse(line);
            if (event.type === "progress") {
              sendProgress({
                step,
                state: "running",
                percent: event.percent,
                message: event.message
              });
            }
          } catch {
            sendProgress({
              step,
              state: "running",
              percent: 50,
              message: line.trim()
            });
          }
        }
      }
    });

    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const lastJsonLine = [...lines].reverse().find((line) => line.trim().startsWith("{"));
    const parsed = lastJsonLine ? JSON.parse(lastJsonLine) : { ok: true, stdout: result.stdout };
    sendProgress({
      step,
      state: "done",
      percent: 100,
      message: `${step} finished`
    });
    return parsed;
  } catch (error) {
    // Python helpers print {"ok": false, "error": "..."} to stdout then exit non-zero.
    // Parse it so the UI shows a plain English message instead of raw JSON.
    let message = error.message;
    try {
      const parsed = JSON.parse(message);
      if (parsed?.error) {
        message = parsed.error;
      }
    } catch {
      // not JSON; use message as-is
    }
    sendProgress({
      step,
      state: "error",
      percent: 100,
      message
    });
    throw new Error(message);
  }
}

module.exports = {
  checkTools,
  composeTimedVoiceTrack,
  createJob,
  extractAudio,
  exportDubbedVideo,
  normalizeAudio,
  runPythonHelper,
  saveRecording
};
