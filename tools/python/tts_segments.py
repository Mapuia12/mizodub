import argparse
import json
from pathlib import Path

from tts_common import DEFAULT_TTS_MODELS, LocalTtsEngine


def emit_progress(percent, message):
    print(json.dumps({"type": "progress", "percent": percent, "message": message}), flush=True)


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(code)


def main():
    parser = argparse.ArgumentParser(description="Generate per-segment TTS audio for timed dubbing.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="mya_Mymr")
    parser.add_argument("--model", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        fail(f"Input segments not found: {input_path}")

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    segments = [
        segment
        for segment in (payload.get("segments") or [])
        if (segment.get("text") or "").strip() and float(segment.get("end", 0)) > float(segment.get("start", 0))
    ]
    if not segments:
        fail("No timed text segments to synthesize")

    try:
        model_name = args.model or DEFAULT_TTS_MODELS.get(args.language, "")
        emit_progress(8, f"Loading TTS model: {model_name}")
        engine = LocalTtsEngine(args.language, model_name)
    except ImportError as exc:
        fail(f"TTS dependencies are not installed: {exc}")
    except Exception as exc:
        fail(f"Could not load TTS model. Details: {exc}")

    output_path = Path(args.output)
    segment_dir = output_path.parent / f"{args.language}-tts-segments"
    segment_dir.mkdir(parents=True, exist_ok=True)

    rendered = []
    for index, segment in enumerate(segments, start=1):
        percent = 10 + int(((index - 1) / max(1, len(segments))) * 84)
        emit_progress(percent, f"Generating voice segment {index}/{len(segments)}")
        audio_path = segment_dir / f"segment-{index:04d}.wav"
        try:
            engine.synthesize_to_file(segment["text"].strip(), audio_path)
        except Exception as exc:
            fail(f"TTS failed on segment {index}: {exc}")

        rendered.append(
            {
                "id": segment.get("id") or f"seg-{index - 1}",
                "start": float(segment.get("start", 0)),
                "end": float(segment.get("end", 0)),
                "text": segment["text"].strip(),
                "audioPath": str(audio_path)
            }
        )

    result = {
        "ok": True,
        "language": args.language,
        "model": model_name,
        "segments": rendered
    }
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress(96, "Segment voice files saved")
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
