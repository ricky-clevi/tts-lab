# Deploying To A VM

This project can be deployed as a single service on a Linux VM:

- FastAPI serves the API
- FastAPI also serves the built React app from `web/dist`
- `systemd` keeps the app running after logout or reboot

This document reflects the deployment flow that worked on the Ubuntu + NVIDIA VM at `10.163.41.43`.

## Target Layout

Recommended app path:

```bash
/home/ricky/tts-lab
```

Recommended model cache path:

```bash
/data/models/huggingface
```

Default service URL:

```text
http://<vm-ip>:8001
```

## Prerequisites

On the VM, confirm:

```bash
nvidia-smi
python3 --version
node --version
npm --version
ffmpeg -version
sox --version
```

Required:

- NVIDIA driver working
- Python available
- Node 22.x
- `ffmpeg`
- `sox`

## Initial Copy

From Windows:

```powershell
scp -r C:\Users\ricky\dastur\tts-lab ricky@<vm-ip>:/home/ricky/
```

On the VM:

```bash
cd /home/ricky/tts-lab
chmod +x scripts/*.sh
```

If the repo was copied from Windows, do not trust copied `node_modules`. Reinstall them on Linux.

## Environment File

Create the runtime config:

```bash
cd /home/ricky/tts-lab
cp .env.example .env
```

Example `.env`:

```env
QWEN_AUDIO_BACKEND=qwen
CUDA_VISIBLE_DEVICES=0
QWEN_AUDIO_DEVICE=cuda:0
QWEN_AUDIO_TORCH_DTYPE=auto
QWEN_AUDIO_ATTN_IMPLEMENTATION=auto

HF_HOME=/data/models/huggingface
HUGGINGFACE_HUB_CACHE=/data/models/huggingface/hub

HOST=0.0.0.0
PORT=8001
```

Prepare the cache path:

```bash
mkdir -p /data/models/huggingface/hub
```

If you want to dedicate a different GPU, set:

```env
CUDA_VISIBLE_DEVICES=2
QWEN_AUDIO_DEVICE=cuda:0
```

That means "only expose physical GPU 2, then use it as logical `cuda:0`".

## Bootstrap

Preferred bootstrap:

```bash
cd /home/ricky/tts-lab
./scripts/bootstrap_linux_nvidia.sh
```

If you need a different Python binary:

```bash
PYTHON_BIN=python3 ./scripts/bootstrap_linux_nvidia.sh
```

What the bootstrap does:

- installs OS packages
- creates `.venv`
- installs CUDA PyTorch
- installs Python app dependencies
- installs `qwen-asr`
- installs `qwen-tts` with `--no-deps` to avoid the current PyPI dependency conflict with `qwen-asr`
- reinstalls frontend packages on Linux
- installs the Rolldown Linux native binding needed by the current Vite toolchain
- builds the React app

## Manual Python Install

If you want the reliable manual sequence instead of the bootstrap:

```bash
cd /home/ricky/tts-lab
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate

python -m pip install -U pip setuptools wheel
python -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision torchaudio
python -m pip install -r server/requirements.txt
python -m pip install -r server/requirements.linux-nvidia.txt
python -m pip install "qwen-asr==0.0.6"
python -m pip install --no-deps "qwen-tts==0.1.1"
```

## Manual Frontend Build

If the frontend was copied from Windows or build tools complain:

```bash
cd /home/ricky/tts-lab
rm -rf node_modules web/node_modules
rm -f web/package-lock.json

npm install
npm --prefix web install --include=optional
npm --prefix web install --no-save @rolldown/binding-linux-x64-gnu
npm run build
```

## Manual Run

To run the app manually:

```bash
cd /home/ricky/tts-lab
source .venv/bin/activate
set -a
source .env
set +a
./scripts/run_linux_server.sh
```

## Verify The Deployment

Local checks on the VM:

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/metrics
curl http://127.0.0.1:8001/ | head
```

Expected:

- `/api/health` shows `runtime_backend = "qwen"`
- `/api/health` shows `selected_device = "cuda:0"`
- `/api/metrics` shows `gpu_backend = "cuda"`
- `/` returns HTML

Check listening socket:

```bash
ss -ltnp | grep 8001
```

Expected:

```text
0.0.0.0:8001
```

From another device on the same network:

```text
http://<vm-ip>:8001
```

## Install As A Service

The repo includes a ready systemd unit:

- [deploy/systemd/qwen3-tts-lab.service](/c:/Users/ricky/dastur/tts-lab/deploy/systemd/qwen3-tts-lab.service)

Install it:

```bash
cd /home/ricky/tts-lab
sudo cp deploy/systemd/qwen3-tts-lab.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable qwen3-tts-lab
sudo systemctl restart qwen3-tts-lab
```

Check status:

```bash
sudo systemctl status qwen3-tts-lab --no-pager -l
```

Follow logs:

```bash
journalctl -u qwen3-tts-lab -f
```

Useful lifecycle commands:

```bash
sudo systemctl restart qwen3-tts-lab
sudo systemctl stop qwen3-tts-lab
sudo systemctl start qwen3-tts-lab
sudo systemctl disable qwen3-tts-lab
```

## Remote Access

If the app works locally but not from another device:

1. Confirm the app is listening on all interfaces:

```bash
ss -ltnp | grep 8001
```

2. Confirm firewall state:

```bash
sudo ufw status
```

If needed:

```bash
sudo ufw allow 8001/tcp
```

3. Confirm network reachability from another device:

```bash
curl http://<vm-ip>:8001/api/health
```

## Useful Diagnostics

Check process:

```bash
ps -ef | grep -E 'uvicorn|python.*server.app.main' | grep -v grep
```

Check service:

```bash
sudo systemctl status qwen3-tts-lab --no-pager -l
```

Check logs:

```bash
journalctl -u qwen3-tts-lab -n 200 --no-pager
journalctl -u qwen3-tts-lab -f
```

Check GPU:

```bash
nvidia-smi
```

Check app health:

```bash
curl http://127.0.0.1:8001/api/health
curl http://127.0.0.1:8001/api/metrics
```

Check frontend HTML:

```bash
curl http://127.0.0.1:8001/ | head
```

## Useful API Smoke Tests

Custom voice generation:

```bash
curl -X POST http://127.0.0.1:8001/api/generate/custom \
  -H 'Content-Type: application/json' \
  -d '{
    "segments":["Hello from the Ubuntu CUDA deployment."],
    "language":"English",
    "speaker":"Ryan",
    "generation":{"temperature":0.7}
  }'
```

Health:

```bash
curl http://127.0.0.1:8001/api/health
```

Metrics:

```bash
curl http://127.0.0.1:8001/api/metrics
```

## Common Failure Modes

### The app worked before, but the URL stopped opening

Cause:

- the app was started manually and the shell exited
- or the VM rebooted

Fix:

```bash
sudo systemctl restart qwen3-tts-lab
sudo systemctl status qwen3-tts-lab --no-pager -l
```

### `tsc: Permission denied`

Cause:

- `node_modules` copied from Windows

Fix:

```bash
rm -rf node_modules web/node_modules
rm -f web/package-lock.json
npm install
npm --prefix web install --include=optional
npm --prefix web install --no-save @rolldown/binding-linux-x64-gnu
npm run build
```

### `Cannot find native binding` from Rolldown

Cause:

- optional Linux native binding not installed by npm

Fix:

```bash
cd web
npm install --include=optional
npm install --no-save @rolldown/binding-linux-x64-gnu
```

### `sox: not found`

Fix:

```bash
sudo apt-get install -y sox libsox-fmt-all
```

### `curl: (7) Failed to connect`

Check:

```bash
ss -ltnp | grep 8001
sudo systemctl status qwen3-tts-lab --no-pager -l
```

## Updating The Deployment

To redeploy after code changes:

```bash
cd /home/ricky/tts-lab
git pull
source .venv/bin/activate
python -m pip install -r server/requirements.txt
python -m pip install -r server/requirements.linux-nvidia.txt
python -m pip install "qwen-asr==0.0.6"
python -m pip install --no-deps "qwen-tts==0.1.1"
npm install
npm --prefix web install --include=optional
npm --prefix web install --no-save @rolldown/binding-linux-x64-gnu
npm run build
sudo systemctl restart qwen3-tts-lab
```
