# Mizo Dub Studio Architecture

## Why this shape

Phase 1 uses Electron because it runs cleanly on Windows without Rust, does not require a backend server, and can call local tools through the main process. The app is still local-first: the renderer is a local HTML UI, the Electron main process orchestrates files, and FFmpeg/Python helpers run on the laptop.

Tauri is a good later target when Rust is installed and packaging size matters. For this Windows laptop prototype, Electron has the lowest setup risk.

## Pipeline

1. User selects an existing recap video.
2. FFmpeg extracts a mono 16 kHz WAV narration track into the app job folder.
3. Optional faster-whisper transcribes English or Chinese narration locally.
4. Optional NLLB translates the transcript draft into Mizo using `lus_Latn`.
5. User edits the final Mizo script.
6. Phase 1 voice path records or imports a Mizo narration file.
7. FFmpeg normalizes the voice audio and replaces the original audio stream.
8. The user saves an MP4 dubbed output.

## Reliability decisions

- FFmpeg is used for all media operations because it is stable, free, and already works well on Windows.
- Manual Mizo recording is the primary voice path because current open-source Mizo TTS and cross-lingual voice cloning are not reliable enough to make the final audio quality automatic.
- AI helpers are optional. If Python model setup fails, the app still works for recording and exporting.
- Each video gets an isolated job folder under Electron `userData`, so source files are not modified.
- Large ML models are not bundled into the prototype. The user can install them later and cache them locally.

## Future upgrade path

- Add subtitle-style segment timing and per-segment recording.
- Add background music preservation with source separation.
- Add OpenVoice or RVC voice conversion as a separate local worker.
- Add a custom Mizo voice model trained from the user's approved recordings.
- Package FFmpeg and a Python runtime as app sidecars for a single installer.
