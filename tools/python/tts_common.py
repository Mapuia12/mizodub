from pathlib import Path


DEFAULT_TTS_MODELS = {
    "mya_Mymr": "facebook/mms-tts-mya",
    "lus_Latn": "andrewbawitlung/SpeechT5-Mizo-Lus-v24.11.19",
}


class LocalTtsEngine:
    def __init__(self, language, model_name=""):
        self.language = language
        self.model_name = model_name or DEFAULT_TTS_MODELS.get(language)
        if not self.model_name:
            raise RuntimeError(f"No default TTS model is configured for {language}")

        if language == "mya_Mymr":
            self._load_mms()
        else:
            self._load_pipeline()

    def _load_mms(self):
        import torch
        from transformers import AutoTokenizer, VitsModel

        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self.model = VitsModel.from_pretrained(self.model_name)
        self.sampling_rate = self.model.config.sampling_rate
        self.mode = "mms"

    def _load_pipeline(self):
        from transformers import pipeline

        self.pipe = pipeline("text-to-speech", model=self.model_name)
        self.mode = "pipeline"

    def synthesize_to_file(self, text, output_path):
        import numpy as np
        import soundfile as sf

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)

        if self.mode == "mms":
            inputs = self.tokenizer(text, return_tensors="pt")
            with self.torch.no_grad():
                waveform = self.model(**inputs).waveform
            audio = waveform.squeeze().cpu().numpy()
            sf.write(str(output), audio, self.sampling_rate)
            return str(output)

        result = self.pipe(text)
        audio = np.asarray(result.get("audio")).squeeze()
        sampling_rate = result.get("sampling_rate")
        if audio is None or sampling_rate is None:
            raise RuntimeError("The TTS model returned an unexpected audio payload")
        sf.write(str(output), audio, sampling_rate)
        return str(output)
