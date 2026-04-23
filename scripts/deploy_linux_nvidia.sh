#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${DEPLOY_ROOT:-/home/ricky/tts-lab}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-windows}"
DEPLOY_REMOTE="${DEPLOY_REMOTE:-origin}"
SERVICE_NAME="${SERVICE_NAME:-qwen3-tts-lab}"
APP_PORT="${PORT:-8001}"
export GIT_TERMINAL_PROMPT=0

cd "$ROOT_DIR"

git_source="${DEPLOY_GIT_REMOTE_URL:-$DEPLOY_REMOTE}"
git_auth_config=()
if [ -n "${DEPLOY_GIT_AUTH_HEADER:-}" ]; then
  git_auth_base_url="${DEPLOY_GIT_AUTH_BASE_URL:-https://gitea.clevics.co.kr/}"
  git_auth_config=(-c "http.${git_auth_base_url}.extraheader=${DEPLOY_GIT_AUTH_HEADER}")
fi

git "${git_auth_config[@]}" fetch "$git_source" "$DEPLOY_BRANCH"

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current_branch" != "$DEPLOY_BRANCH" ]; then
  if git show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
    git checkout "$DEPLOY_BRANCH"
  else
    git checkout -b "$DEPLOY_BRANCH"
  fi
fi

git merge --ff-only FETCH_HEAD

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if sudo -n true 2>/dev/null; then
    sudo "$@"
    return
  fi

  if [ -n "${DEPLOY_SUDO_PASSWORD:-}" ]; then
    printf '%s\n' "$DEPLOY_SUDO_PASSWORD" | sudo -S -p '' "$@"
    return
  fi

  sudo "$@"
}

if [ -d ".venv" ]; then
  source .venv/bin/activate
else
  python3 -m venv .venv
  source .venv/bin/activate
fi

python -m pip install -U pip setuptools wheel
python -m pip install -r server/requirements.txt
python -m pip install -r server/requirements.linux-nvidia.txt
python -m pip install "qwen-asr==${QWEN_ASR_VERSION:-0.0.6}"
python -m pip install --no-deps "qwen-tts==${QWEN_TTS_VERSION:-0.1.1}"

npm install
npm --prefix web install --include=optional
npm --prefix web install --no-save @rolldown/binding-linux-x64-gnu
npm run build

run_privileged systemctl restart "$SERVICE_NAME"

for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/tmp/tts-lab-health.json; then
    cat /tmp/tts-lab-health.json
    echo
    exit 0
  fi
  sleep 2
done

run_privileged systemctl status "$SERVICE_NAME" --no-pager -l || true
journalctl -u "$SERVICE_NAME" -n 100 --no-pager || true
echo "Deployment failed: health check did not pass on port ${APP_PORT}." >&2
exit 1
