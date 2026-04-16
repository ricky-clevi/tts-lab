#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/.venv}"

# Source environment variables when present so the systemd deployment and
# ad-hoc shell runs behave the same way.
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8001}"

ensure_writable_cache_dir() {
    local configured_root="$1"
    local fallback_root="$2"
    local probe_dir=""

    if [ -n "$configured_root" ]; then
        probe_dir="$configured_root"
        if [ -n "${HUGGINGFACE_HUB_CACHE:-}" ]; then
            probe_dir="$(dirname "$HUGGINGFACE_HUB_CACHE")"
        fi
        mkdir -p "$probe_dir" 2>/dev/null || true
        if [ -w "$probe_dir" ]; then
            return
        fi
        echo "[tts-lab] Cache path '$probe_dir' is not writable. Falling back to '$fallback_root'." >&2
    fi

    mkdir -p "$fallback_root"
    export HF_HOME="$fallback_root"
    export HUGGINGFACE_HUB_CACHE="$fallback_root/hub"
    export TRANSFORMERS_CACHE="$fallback_root/transformers"
}

LOCAL_HF_CACHE_ROOT="${ROOT_DIR}/generated/cache/huggingface"
ensure_writable_cache_dir "${HF_HOME:-}" "$LOCAL_HF_CACHE_ROOT"
mkdir -p "${HUGGINGFACE_HUB_CACHE:-$LOCAL_HF_CACHE_ROOT/hub}" "${TRANSFORMERS_CACHE:-$LOCAL_HF_CACHE_ROOT/transformers}"

source "$VENV_DIR/bin/activate"
cd "$ROOT_DIR"

exec python -m uvicorn server.app.main:app --host "$HOST" --port "$PORT"
