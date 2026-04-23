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

## Gitea CI/CD

The repo includes a Gitea Actions workflow:

```text
.gitea/workflows/deploy-windows.yml
```

It runs automatically on pushes to the `windows` branch and can also be started manually from the Gitea Actions UI.

The deploy job is designed to run on a Gitea runner installed directly on the deployment VM. This avoids relying on a central runner being able to reach `10.163.41.43:22`.

Required runner label:

```text
tts-lab-deploy:host
```

Required Gitea repository or organization secrets:

```text
DEPLOY_SUDO_PASSWORD=<optional password for sudo -S when NOPASSWD sudo is not configured>
DEPLOY_ROOT=/home/ricky/tts-lab
DEPLOY_GIT_REMOTE_URL=https://gitea.clevics.co.kr/CleviCS/Onprem.git
```

`DEPLOY_ROOT` and `DEPLOY_SUDO_PASSWORD` may be omitted when the VM already uses `/home/ricky/tts-lab` and the deploy user has passwordless sudo for the service restart. Keep `DEPLOY_GIT_REMOTE_URL` set for first deploys or when the VM checkout does not already have a usable `origin`.

The workflow:

1. Installs frontend dependencies.
2. Builds the React app.
3. Compiles the FastAPI entrypoint.
4. Schedules deployment on the VM-local runner with label `tts-lab-deploy`.
5. Updates `/home/ricky/tts-lab` from the `windows` branch.
6. Runs `scripts/deploy_linux_nvidia.sh`.

The VM deploy script performs an ff-only pull of `windows`, installs runtime dependencies, rebuilds `web/dist`, restarts `qwen3-tts-lab`, and checks `/api/health`.

### Install The VM Gitea Runner

Install the runner on the deployment VM as `ricky`. Use the repository runner registration token from Gitea:

```bash
cd /home/ricky/tts-lab
git fetch https://gitea.clevics.co.kr/CleviCS/Onprem.git windows
git checkout windows
git merge --ff-only FETCH_HEAD
chmod +x scripts/install_gitea_runner_tts_lab.sh
GITEA_RUNNER_REGISTRATION_TOKEN='<repository-runner-token>' ./scripts/install_gitea_runner_tts_lab.sh
```

The installer:

- downloads the `act_runner` binary
- registers a repository runner named `tts-lab-deploy-<hostname>`
- assigns the label `tts-lab-deploy:host`
- installs and starts a user-level systemd service named `tts-lab-act-runner`

Check the runner service:

```bash
systemctl --user status tts-lab-act-runner --no-pager -l
journalctl --user -u tts-lab-act-runner -f
```

Allow the user service to survive logout and reboot:

```bash
sudo loginctl enable-linger ricky
```

After the runner appears online in Gitea, push to `windows` or manually re-run the workflow.

The deploy user must be able to restart the service non-interactively. Prefer a narrow passwordless sudoers rule:

```text
ricky ALL=(root) NOPASSWD: /bin/systemctl restart qwen3-tts-lab, /bin/systemctl status qwen3-tts-lab
```

Adjust `/bin/systemctl` to the actual path from `command -v systemctl` on the VM if needed.

## Qwen3-Embedding-8B Deployment (4x RTX 6000 Ada)

This section documents the exact runbook that worked on `10.163.41.43` on April 13, 2026 for serving embeddings with vLLM.

### Goal

Serve `Qwen/Qwen3-Embedding-8B` as an OpenAI-compatible embeddings API on:

```text
http://<vm-ip>:8000/v1/embeddings
```

### Host Validation

On the VM:

```bash
nvidia-smi
docker version
```

Expected:

- 4x NVIDIA RTX 6000 Ada visible
- Docker daemon running

### Docker + NVIDIA Runtime Setup

If not already configured:

```bash
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Start The Embedding Server (Working Command)

```bash
docker rm -f qwen3-embed 2>/dev/null || true
mkdir -p /home/ricky/hf-cache

docker run -d --name qwen3-embed \
  --restart unless-stopped \
  --gpus all \
  --ipc=host \
  -p 8000:8000 \
  -v /home/ricky/hf-cache:/root/.cache/huggingface \
  vllm/vllm-openai:latest \
  Qwen/Qwen3-Embedding-8B \
  --runner pooling \
  --convert embed \
  --tensor-parallel-size 4 \
  --dtype bfloat16 \
  --max-model-len 8192 \
  --served-model-name qwen3-embed-8b
```

### Verify

```bash
docker ps --filter name=qwen3-embed
docker logs --tail 200 qwen3-embed
curl http://localhost:8000/v1/models
```

Functional embedding test:

```bash
curl http://localhost:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-embed-8b","input":["Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: What is the capital of China?"]}'
```

### Remote Use From Another Server

From a remote machine:

```bash
curl http://10.163.41.43:8000/v1/models
curl http://10.163.41.43:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3-embed-8b","input":["hello from remote server"]}'
```

If UFW is enabled, allow only trusted source IPs:

```bash
sudo ufw allow from <REMOTE_SERVER_IP> to any port 8000 proto tcp
sudo ufw status
```

### Important Fixes Learned During Bring-Up

1. `--task embed` is invalid on current `vllm serve` CLI.
Use:

```bash
--runner pooling --convert embed
```

2. `VLLM_ENABLE_CUDA_COMPATIBILITY=1` caused:

```text
Error 803: system has unsupported display driver / cuda driver combination
```

Fix: remove that environment variable on this host/driver.

3. `curl: (56) Recv failure: Connection reset by peer` during startup usually means the container is crash-looping.
Check:

```bash
docker ps -a --filter name=qwen3-embed
docker inspect qwen3-embed --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} error={{.State.Error}}'
docker logs --tail 200 qwen3-embed
```

4. `docker logs -f qwen3-embed` attaches to log stream only.
Press `Ctrl+C` to stop following logs. The container continues running in detached mode.

### Operations

```bash
docker restart qwen3-embed
docker logs --tail 200 qwen3-embed
docker rm -f qwen3-embed
```

### Security Notes

- Restrict TCP/8000 to trusted internal callers.
- Add TLS/authentication (Nginx or Caddy) before broader exposure.
- Rotate any credentials that were shared in chat/session history.
