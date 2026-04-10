#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8001}"

source "$VENV_DIR/bin/activate"
cd "$ROOT_DIR"

exec python -m uvicorn server.app.main:app --host "$HOST" --port "$PORT"
