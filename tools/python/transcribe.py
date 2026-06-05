import argparse
import json
import sys
from pathlib import Path


def emit_progress(percent, message):
    print(json.dumps({"type": "progress", "percent": percent, "message": message}), flush=True)


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(code)


def main():
    parser = argparse.ArgumentParser(description="Local Whisper transcription helper.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        fail(f"Audio file not found: {audio_path}")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail(
            "faster-whisper is not installed. Run scripts/setup-ai.ps1 with Python 3.11, "
            "or paste the transcript manually."
        )

    language = None if args.language == "auto" else args.language
    emit_progress(10, f"Loading Whisper model: {args.model}")
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    emit_progress(35, "Transcribing narration")
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500}
    )

    segments = []
    for segment in segments_iter:
        segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip()
            }
        )
        if info.duration:
            percent = 35 + min(55, int((segment.end / info.duration) * 55))
            emit_progress(percent, f"Transcribed {segment.end:.1f}s")

    text = "\n".join(item["text"] for item in segments if item["text"])
    payload = {
        "ok": True,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": segments,
        "text": text
    }

    output_path = Path(args.output)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress(95, "Transcript saved")
    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
