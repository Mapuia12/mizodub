import argparse
import json
from pathlib import Path


def emit_progress(percent, message):
    print(json.dumps({"type": "progress", "percent": percent, "message": message}), flush=True)


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(code)


def main():
    parser = argparse.ArgumentParser(description="Best-effort local Mizo TTS helper.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="andrewbawitlung/SpeechT5-Mizo-Lus-v24.11.19")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        fail(f"Input script not found: {input_path}")

    text = input_path.read_text(encoding="utf-8").strip()
    if not text:
        fail("Mizo script is empty")

    try:
        import soundfile as sf
        from transformers import pipeline
    except ImportError:
        fail(
            "TTS dependencies are not installed. Recording your own Mizo narration is the stable Phase 1 path."
        )

    try:
        emit_progress(10, f"Loading TTS model: {args.model}")
        synthesizer = pipeline("text-to-speech", model=args.model)
        emit_progress(45, "Generating Mizo speech")
        result = synthesizer(text)
    except Exception as exc:
        fail(
            "The selected Mizo TTS model could not run through the generic Transformers pipeline. "
            f"Use recording/import for this clip. Details: {exc}"
        )

    audio = result.get("audio")
    sampling_rate = result.get("sampling_rate")
    if audio is None or sampling_rate is None:
        fail("The TTS model returned an unexpected audio payload")

    output_path = Path(args.output)
    sf.write(str(output_path), audio, sampling_rate)
    payload = {
        "ok": True,
        "model": args.model,
        "output": str(output_path)
    }
    emit_progress(95, "TTS audio saved")
    print(json.dumps(payload), flush=True)


if __name__ == "__main__":
    main()
