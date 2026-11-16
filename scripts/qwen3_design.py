"""Diseña la voz del narrador con Qwen3-TTS VoiceDesign a partir de una descripción en texto.

Uso: python qwen3_design.py <salida.wav> <descripción> <texto> [semilla] [modelo]
Genera <salida.wav> y <salida.txt> (transcripción), que el worker usa para clonar la voz.
"""
import sys

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

out, description, text = sys.argv[1], sys.argv[2], sys.argv[3]
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 42
model_id = sys.argv[5] if len(sys.argv) > 5 else "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

if torch.cuda.is_available():
    device, dtype = "cuda:0", torch.bfloat16
elif torch.backends.mps.is_available():
    device, dtype = "mps", torch.float32
else:
    device, dtype = "cpu", torch.float32

model = Qwen3TTSModel.from_pretrained(model_id, device_map=device, dtype=dtype)
torch.manual_seed(seed)
wavs, sr = model.generate_voice_design(text=text, instruct=description, language="Spanish")
sf.write(out, np.asarray(wavs[0], dtype=np.float32), sr)
with open(out.rsplit(".", 1)[0] + ".txt", "w", encoding="utf-8") as f:
    f.write(text)
print(f"{out}: {len(wavs[0]) / sr:.1f} s")
