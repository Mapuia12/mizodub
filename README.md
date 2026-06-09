# Mizo Dub Studio

Windows-local prototype for dubbing English or Chinese recap videos into Mizo.

## What works now

- Select a local video.
- Extract its audio with FFmpeg.
- Paste, edit, or optionally generate a transcript.
- Write or optionally draft a Mizo or Myanmar dub script.
- Keep transcript timestamps as editable timed segments.
- Record your own Mizo narration in the app, or import an audio file.
- Generate Myanmar AI voice locally with timed segment alignment.
- Replace the video's audio and export a dubbed MP4.

This Phase 1 build is designed so the reliable path works even before heavy AI models are installed.

## Requirements

- Windows 10 or 11
- Node.js 20+
- FFmpeg and FFprobe on PATH
- Optional for AI helpers: Python 3.11

Your current machine already has Node and FFmpeg available. Python 3.14 is installed, but most AI packages are safer on Python 3.11.

## Install

```powershell
npm install
```

## Run

```powershell
npm start
```

## Optional AI setup

Install Python 3.11 first. Then run:

```powershell
.\scripts\setup-ai.ps1
```

The app automatically uses `.venv-ai\Scripts\python.exe` when that environment exists.

The first transcription or translation run may download model files. For free local use, these models are practical:

- Transcription: `faster-whisper` with `small` or `medium`
- Translation draft: `facebook/nllb-200-distilled-600M`, using Mizo `lus_Latn` or Myanmar `mya_Mymr`
- Myanmar TTS: `facebook/mms-tts-mya`
- TTS experiment: `andrewbawitlung/SpeechT5-Mizo-Lus-v24.11.19`

For best Mizo quality today, record your own narration and use the app to export the final dubbed video. For Myanmar voice-over, use the timed AI voice button after you have timestamped transcript segments.

## Folder structure

```text
src/main/        Electron main process, IPC, FFmpeg orchestration
src/renderer/    Local desktop UI
tools/python/    Optional local AI helper scripts
scripts/         Windows setup helpers
docs/            Architecture notes
```

## Recommended workflow

1. Choose a recap video.
2. Extract audio.
3. Paste or transcribe the source narration.
4. Choose target voice language: Mizo or Myanmar.
5. Translate or rewrite the target script.
6. For good scene sync, edit the timed segment target text instead of only the big script box.
7. For Myanmar, click `Generate timed AI voice`.
8. For Mizo, record/import your voice, or try experimental TTS.
9. Export the dubbed MP4.

The app never modifies the original video.

## Timing and voice cloning notes

Whole-recorded audio can drift because it replaces the video audio as one continuous file. The synced workflow is now segment-based: Whisper/faster-whisper returns start and end times, the app keeps those segments editable, then timed AI voice generates one audio file per segment and FFmpeg places each segment back at the original timestamp.

Local free voice cloning is not a stable core feature yet for Mizo/Myanmar. OpenVoice or RVC can be added later as a separate experimental worker, but they need reference audio, model setup, and quality checks. The reliable Phase 1 options are timed Myanmar AI TTS and manual Mizo recording/import.
