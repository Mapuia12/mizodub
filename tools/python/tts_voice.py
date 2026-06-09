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
    parser = argparse.ArgumentParser(description="Local TTS helper for whole-script voice drafts.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="lus_Latn")
    parser.add_argument("--model", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        fail(f"Input script not found: {input_path}")

    text = input_path.read_text(encoding="utf-8").strip()
    if not text:
        fail("Voice script is empty")

    try:
        model_name = args.model or DEFAULT_TTS_MODELS.get(args.language, "")
        emit_progress(10, f"Loading TTS model: {model_name}")
        engine = LocalTtsEngine(args.language, model_name)
        emit_progress(45, "Generating speech")
        engine.synthesize_to_file(text, args.output)
    except ImportError as exc:
        fail(f"TTS dependencies are not installed: {exc}")
    except Exception as exc:
        fail(f"TTS failed. For Mizo, use recording/import if the experimental model is unavailable. Details: {exc}")

    result = {
        "ok": True,
        "language": args.language,
        "model": model_name,
        "output": str(Path(args.output))
    }
    emit_progress(95, "TTS audio saved")
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
