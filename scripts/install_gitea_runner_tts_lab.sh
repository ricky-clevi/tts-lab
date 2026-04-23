#!/usr/bin/env bash
set -euo pipefail

GITEA_INSTANCE_URL="${GITEA_INSTANCE_URL:-https://gitea.clevics.co.kr/}"
RUNNER_NAME="${RUNNER_NAME:-tts-lab-deploy-$(hostname -s)}"
RUNNER_LABELS="${RUNNER_LABELS:-tts-lab-deploy:host}"
ACT_RUNNER_VERSION="${ACT_RUNNER_VERSION:-0.2.13}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/.local/share/act_runner/tts-lab}"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.config/act_runner/tts-lab}"
SERVICE_NAME="${SERVICE_NAME:-tts-lab-act-runner}"

if [ -z "${GITEA_RUNNER_REGISTRATION_TOKEN:-}" ]; then
  echo "GITEA_RUNNER_REGISTRATION_TOKEN is required." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64 | amd64)
    platform="linux-amd64"
    ;;
  aarch64 | arm64)
    platform="linux-arm64"
    ;;
  armv7l)
    platform="linux-arm-7"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

mkdir -p "$INSTALL_DIR" "$RUNNER_DIR" "$CONFIG_DIR" "$HOME/.config/systemd/user"

binary="$INSTALL_DIR/act_runner"
download_url="${ACT_RUNNER_DOWNLOAD_URL:-https://dl.gitea.com/act_runner/${ACT_RUNNER_VERSION}/act_runner-${ACT_RUNNER_VERSION}-${platform}}"

if [ ! -x "$binary" ]; then
  tmp_binary="$(mktemp)"
  curl -fsSL "$download_url" -o "$tmp_binary"
  chmod +x "$tmp_binary"
  mv "$tmp_binary" "$binary"
fi

config_path="$CONFIG_DIR/config.yaml"
if [ ! -f "$config_path" ]; then
  "$binary" generate-config > "$config_path"
fi

python3 - "$config_path" "$RUNNER_LABELS" <<'PY'
import sys

path = sys.argv[1]
labels = [label.strip() for label in sys.argv[2].split(",") if label.strip()]
if not labels:
    raise SystemExit("At least one runner label is required.")

with open(path, "r", encoding="utf-8") as f:
    lines = f.readlines()

out = []
in_runner = False
skipping_labels = False
replaced = False

for line in lines:
    stripped = line.strip()

    if line.startswith("runner:"):
        in_runner = True
    elif in_runner and stripped and not line.startswith((" ", "#")):
        if not replaced:
            out.append("  labels:\n")
            out.extend(f'    - "{label}"\n' for label in labels)
            replaced = True
        in_runner = False

    if skipping_labels:
        if line.startswith("    - ") or not stripped:
            continue
        skipping_labels = False

    if in_runner and line.startswith("  labels:"):
        out.append("  labels:\n")
        out.extend(f'    - "{label}"\n' for label in labels)
        replaced = True
        skipping_labels = True
        continue

    out.append(line)

if in_runner and not replaced:
    out.append("  labels:\n")
    out.extend(f'    - "{label}"\n' for label in labels)

with open(path, "w", encoding="utf-8") as f:
    f.writelines(out)
PY

cd "$RUNNER_DIR"

if [ ! -f ".runner" ]; then
  "$binary" --config "$config_path" register \
    --no-interactive \
    --instance "$GITEA_INSTANCE_URL" \
    --token "$GITEA_RUNNER_REGISTRATION_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABELS"
fi

service_path="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
cat > "$service_path" <<SERVICE
[Unit]
Description=Gitea Actions runner for TTS Lab deployment
Documentation=https://gitea.com/gitea/act_runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${RUNNER_DIR}
ExecStart=${binary} daemon --config ${config_path}
Restart=always
RestartSec=10
TimeoutSec=0

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

echo "Runner service installed: ${SERVICE_NAME}"
echo "Runner label: ${RUNNER_LABELS}"
echo "Check status with: systemctl --user status ${SERVICE_NAME} --no-pager -l"
echo "For boot persistence after logout, run: sudo loginctl enable-linger $(id -un)"
