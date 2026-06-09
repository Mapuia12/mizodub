# AFTER
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # fix Mizo chars on Windows
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "300")     # 5 min; default 10 s is too short


def emit_progress(percent, message):
    print(json.dumps({"type": "progress", "percent": percent, "message": message}), flush=True)


def fail(message, code=2):
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(code)


def chunk_text(text, max_chars=900):
    paragraphs = [part.strip() for part in re.split(r"\n+", text) if part.strip()]
    chunks = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = paragraph
    if current:
        chunks.append(current)
    return chunks or [text.strip()]


def main():
    parser = argparse.ArgumentParser(description="Local NLLB translation helper for Mizo drafts.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--source-language", default="eng_Latn")
    parser.add_argument("--target-language", default="lus_Latn")
    parser.add_argument("--model", default="facebook/nllb-200-distilled-600M")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        fail(f"Input text not found: {input_path}")

    text = input_path.read_text(encoding="utf-8").strip()
    if not text:
        fail("Input text is empty")

    try:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
    except ImportError:
        fail(
            "transformers is not installed. Run scripts/setup-ai.ps1 with Python 3.11, "
            "or translate/rewrite the script manually."
        )

    emit_progress(10, f"Loading translation model: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model, src_lang=args.source_language)
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)

    forced_bos_token_id = tokenizer.convert_tokens_to_ids(args.target_language)
    if forced_bos_token_id is None or forced_bos_token_id == tokenizer.unk_token_id:
        fail(f"The selected model does not expose the NLLB language token {args.target_language}")

    chunks = chunk_text(text)
    translated_chunks = []

    for index, chunk in enumerate(chunks, start=1):
        percent = 15 + int(((index - 1) / max(1, len(chunks))) * 75)
        emit_progress(percent, f"Translating chunk {index}/{len(chunks)}")
        encoded = tokenizer(chunk, return_tensors="pt", truncation=True, max_length=512)
        generated = model.generate(
            **encoded,
            forced_bos_token_id=forced_bos_token_id,
            max_new_tokens=512,
            num_beams=4
        )
        translated = tokenizer.batch_decode(generated, skip_special_tokens=True)[0].strip()
        translated_chunks.append(translated)

    output_text = "\n\n".join(translated_chunks)
    payload = {
        "ok": True,
        "source_language": args.source_language,
        "target_language": args.target_language,
        "model": args.model,
        "text": output_text
    }

    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress(95, "Mizo draft saved")
    print(json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
