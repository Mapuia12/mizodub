const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  composeTimedVoiceTrack,
  createJob,
  extractAudio,
  exportDubbedVideo,
  normalizeAudio
} = require("../src/main/pipeline");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mizo-dub-smoke-"));
  const videoPath = path.join(tmp, "source.mp4");
  const voicePath = path.join(tmp, "voice.wav");
  const voicePath2 = path.join(tmp, "voice2.wav");
  const manifestPath = path.join(tmp, "timed-segments.json");
  const timedVoicePath = path.join(tmp, "timed-voice.m4a");
  const outputPath = path.join(tmp, "dubbed.mp4");
  const progress = [];
  const sendProgress = (event) => progress.push(event);

  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    videoPath
  ]);

  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=2",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    voicePath
  ]);

  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=1",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    voicePath2
  ]);

  const job = await createJob(tmp, videoPath);
  const extracted = await extractAudio({ videoPath, jobDir: job.dir, sendProgress });
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        segments: [
          { start: 0, end: 0.9, audioPath: voicePath },
          { start: 1.1, end: 1.9, audioPath: voicePath2 }
        ]
      },
      null,
      2
    )
  );
  const timed = await composeTimedVoiceTrack({
    manifestPath,
    outputPath: timedVoicePath,
    sendProgress
  });
  const normalized = await normalizeAudio({
    inputPath: voicePath,
    jobDir: job.dir,
    name: "voice-normalized",
    sendProgress
  });
  const exported = await exportDubbedVideo({
    videoPath,
    audioPath: timed.outputPath,
    outputPath,
    sendProgress
  });

  const checks = await Promise.all([
    fs.stat(extracted.path),
    fs.stat(timed.outputPath),
    fs.stat(normalized.path),
    fs.stat(exported.outputPath)
  ]);

  if (checks.some((item) => item.size <= 0)) {
    throw new Error("Smoke test produced an empty file");
  }

  console.log(`Smoke test passed: ${exported.outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
