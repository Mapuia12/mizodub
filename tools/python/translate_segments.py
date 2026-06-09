import argparse
import json
from pathlib import Path


def emit_progress(percent, message):
    print(json.dumps({"type": "progress", "percent": percent, "message": message}), flush=True)


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(code)


def main():
    parser = argparse.ArgumentParser(description="Translate timestamped transcript segments.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-language", default="eng_Latn")
    parser.add_argument("--target-language", default="lus_Latn")
    parser.add_argument("--model", default="facebook/nllb-200-distilled-600M")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        fail(f"Input segments not found: {input_path}")

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    segments = payload.get("segments") or []
    segments = [segment for segment in segments if (segment.get("text") or "").strip()]
    if not segments:
        fail("No segment text to translate")

    try:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError:
        fail(
            "transformers is not installed. Run scripts/setup-ai.ps1 with Python 3.11, "
            "or edit the timed target text manually."
        )

    emit_progress(8, f"Loading translation model: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model, src_lang=args.source_language)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)
    forced_bos_token_id = tokenizer.convert_tokens_to_ids(args.target_language)
    if forced_bos_token_id is None or forced_bos_token_id == tokenizer.unk_token_id:
        fail(f"The selected model does not expose the NLLB language token {args.target_language}")

    translated_segments = []
    for index, segment in enumerate(segments, start=1):
        text = (segment.get("text") or "").strip()
        percent = 12 + int(((index - 1) / max(1, len(segments))) * 80)
        emit_progress(percent, f"Translating segment {index}/{len(segments)}")
        encoded = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
        generated = model.generate(
            **encoded,
            forced_bos_token_id=forced_bos_token_id,
            max_new_tokens=256,
            num_beams=4
        )
        translated = tokenizer.batch_decode(generated, skip_special_tokens=True)[0].strip()
        translated_segments.append(
            {
                "id": segment.get("id") or f"seg-{index - 1}",
                "start": segment.get("start", 0),
                "end": segment.get("end", 0),
                "text": text,
                "targetText": translated
            }
        )

    result = {
        "ok": True,
        "source_language": args.source_language,
        "target_language": args.target_language,
        "segments": translated_segments,
        "text": "\n".join(segment["targetText"] for segment in translated_segments)
    }
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress(96, "Timed translation saved")
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
