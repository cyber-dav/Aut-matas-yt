#!/usr/bin/env bash
# Instala la voz local Qwen3-TTS (VoiceDesign + clonación) en ~/.venvs/qwen3tts.
# En Mac con Apple Silicon también puedes usar la skill qwen3-tts-mlx (mlx-audio), más rápida.
set -euo pipefail
VENV="${QWEN3_VENV:-$HOME/.venvs/qwen3tts}"
if command -v uv >/dev/null; then
  uv venv -p 3.12 "$VENV"
  PIP="uv pip install --python $VENV/bin/python"
else
  python3.12 -m venv "$VENV" || python3 -m venv "$VENV"
  PIP="$VENV/bin/pip install"
fi
$PIP numpy setuptools wheel
$PIP --no-build-isolation sox || true
$PIP qwen-tts soundfile
command -v sox >/dev/null || echo "Aviso: instala SoX (brew install sox / apt-get install sox)"
echo "Listo. Los modelos (~4 GB cada uno) se descargan de Hugging Face la primera vez."
echo "Diseña la voz del narrador con:  npm run voice:design"
