"""Proceso persistente de TTS local con Qwen3-TTS (clonación de una voz diseñada).

La voz del canal se diseña UNA vez con el modelo VoiceDesign (`npm run voice:design`) y se guarda
como clip de referencia (assets/voice/narrador.wav + .txt). Aquí se clona con el modelo Base, así el
narrador suena idéntico en todas las escenas.

Protocolo (igual que kokoro_worker.py): JSON por línea en stdin
  {"text": "...", "out": "/ruta.wav"}
→ {"ok": true, "seconds": 3.2, "speech_start": 0.05, "speech_end": 3.1}
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

model_id = os.environ.get("QWEN3_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
ref_audio = os.environ["QWEN3_REF_AUDIO"]
ref_text = open(os.environ["QWEN3_REF_TEXT"], encoding="utf-8").read().strip()
language = os.environ.get("QWEN3_LANGUAGE", "Spanish")
seed = int(os.environ.get("QWEN3_SEED", "1234"))

if torch.cuda.is_available():
    device, dtype = "cuda:0", torch.bfloat16
elif torch.backends.mps.is_available():
    device, dtype = "mps", torch.float32
else:
    device, dtype = "cpu", torch.float32

model = Qwen3TTSModel.from_pretrained(model_id, device_map=device, dtype=dtype)
prompt = model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)


def speech_bounds(audio: np.ndarray, sr: int) -> tuple[float, float]:
    win = max(1, sr // 100)
    n = len(audio) // win
    if n == 0:
        return 0.0, len(audio) / sr
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    active = np.where(20 * np.log10(rms) > -40)[0]
    if len(active) == 0:
        return 0.0, len(audio) / sr
    return active[0] * win / sr, min(len(audio), (active[-1] + 1) * win) / sr


print(json.dumps({"ready": True, "device": device}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        torch.manual_seed(seed)
        wavs, sr = model.generate_voice_clone(text=req["text"], language=language, voice_clone_prompt=prompt)
        audio = np.asarray(wavs[0], dtype=np.float32)
        sf.write(req["out"], audio, sr)
        start, end = speech_bounds(audio, sr)
        print(json.dumps({"ok": True, "seconds": len(audio) / sr, "speech_start": start, "speech_end": end}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
