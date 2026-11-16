#!/usr/bin/env bash
# Instala la voz local Kokoro-82M (motor de la skill media-use de HyperFrames). Gratis, sin clave.
set -euo pipefail
DIR="${KOKORO_MODEL_DIR:-$HOME/.cache/kokoro}"
mkdir -p "$DIR"
BASE=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
[ -f "$DIR/kokoro-v1.0.onnx" ] || curl -fL -o "$DIR/kokoro-v1.0.onnx" "$BASE/kokoro-v1.0.onnx"
[ -f "$DIR/voices-v1.0.bin" ] || curl -fL -o "$DIR/voices-v1.0.bin" "$BASE/voices-v1.0.bin"
python3 -m pip install --user kokoro-onnx soundfile 2>/dev/null || python3 -m pip install --break-system-packages kokoro-onnx soundfile
if ! command -v espeak-ng >/dev/null; then
  echo "Falta espeak-ng (necesario para español): macOS → brew install espeak-ng · Debian/Ubuntu → sudo apt-get install espeak-ng"
  exit 1
fi
echo "Kokoro listo en $DIR"
