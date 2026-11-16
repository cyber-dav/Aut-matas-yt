"""Proceso persistente de TTS local con Kokoro-82M (kokoro-onnx).

Protocolo: una petición JSON por línea en stdin
  {"text": "...", "voice": "em_alex", "speed": 1.0, "lang": "es", "out": "/ruta/salida.wav"}
y una respuesta JSON por línea en stdout
  {"ok": true, "seconds": 3.21, "speech_start": 0.08, "speech_end": 3.05}

speech_start/speech_end delimitan la zona con voz (sin silencios de los extremos) para
repartir los tiempos de las palabras. Mismo motor que la skill media-use de HyperFrames.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

model_dir = os.environ.get("KOKORO_MODEL_DIR", os.path.expanduser("~/.cache/kokoro"))
kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))


def speech_bounds(audio: np.ndarray, sr: int) -> tuple[float, float]:
    """Inicio y fin de la voz: primera/última ventana de 10 ms por encima de −40 dBFS."""
    win = max(1, sr // 100)
    n = len(audio) // win
    if n == 0:
        return 0.0, len(audio) / sr
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    active = np.where(20 * np.log10(rms) > -40)[0]
    if len(active) == 0:
        return 0.0, len(audio) / sr
    return active[0] * win / sr, min(len(audio), (active[-1] + 1) * win) / sr


print(json.dumps({"ready": True, "voices": kokoro.get_voices()}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        audio, sr = kokoro.create(req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "es"))
        sf.write(req["out"], audio, sr)
        start, end = speech_bounds(audio, sr)
        print(json.dumps({"ok": True, "seconds": len(audio) / sr, "speech_start": start, "speech_end": end}), flush=True)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
