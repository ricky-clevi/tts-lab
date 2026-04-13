#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v python3.12 >/dev/null 2>&1; then
  DEFAULT_PYTHON_BIN="python3.12"
else
  DEFAULT_PYTHON_BIN="python3"
fi
PYTHON_BIN="${PYTHON_BIN:-$DEFAULT_PYTHON_BIN}"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
TORCH_INDEX_URL="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cu128}"
INSTALL_FLASH_ATTN="${INSTALL_FLASH_ATTN:-0}"
QWEN_ASR_VERSION="${QWEN_ASR_VERSION:-0.0.6}"
QWEN_TTS_VERSION="${QWEN_TTS_VERSION:-0.1.1}"

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    build-essential \
    curl \
    ffmpeg \
    git \
    libsox-fmt-all \
    libsndfile1 \
    pkg-config \
    python3-venv

  if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi was not found. Install the NVIDIA driver stack before running this bootstrap." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found after bootstrap. Install Node.js 22.x before continuing." >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

python -m pip install --upgrade pip setuptools wheel
python -m pip install --index-url "$TORCH_INDEX_URL" torch torchvision torchaudio
python -m pip install -r "$ROOT_DIR/server/requirements.linux-nvidia.txt"
python -m pip install "qwen-asr==${QWEN_ASR_VERSION}"
python -m pip install --no-deps "qwen-tts==${QWEN_TTS_VERSION}"

if [[ "$INSTALL_FLASH_ATTN" == "1" ]]; then
  python -m pip install flash-attn --no-build-isolation
fi

npm install --prefix "$ROOT_DIR"
npm install --prefix "$ROOT_DIR/web" --include=optional
npm install --prefix "$ROOT_DIR/web" --no-save @rolldown/binding-linux-x64-gnu
npm run build --prefix "$ROOT_DIR"
