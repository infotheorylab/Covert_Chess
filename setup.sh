# RunPod Startup Checklist
# Every time you start a fresh pod, run these in order.
# Takes ~20 min total (mostly model download).

## 0. Point HuggingFace + pip caches at the big /workspace volume
# WHY: the container disk mounted at "/" is only ~20 GB and fills instantly with
# one 8B model, causing "No space left" / "Disk quota exceeded (os error 122)".
# /workspace is the large persistent volume — put every big cache there, and do
# it BEFORE anything imports transformers or downloads weights.
#
# NOTE ON QUOTA: /workspace is a network volume with a PROVISIONED SIZE (set in
# the RunPod dashboard), enforced as a quota even though the underlying storage
# is huge. Llama-3.1-8B (~16 GB) + phi-4 (~29 GB) need ~50 GB; give the volume
# at least 80 GB in the dashboard or the download still fails with EDQUOT.
export HF_HOME=/workspace/hf-cache
export HUGGINGFACE_HUB_CACHE=/workspace/hf-cache/hub
export TRANSFORMERS_CACHE=/workspace/hf-cache/hub
export PIP_CACHE_DIR=/workspace/pip-cache
export XDG_CACHE_HOME=/workspace/.cache
mkdir -p "$HF_HOME" "$PIP_CACHE_DIR" "$XDG_CACHE_HOME"

# Persist these so warm restarts (new shells) keep using /workspace, not "/".
# Guarded so re-running setup.sh doesn't append duplicates.
grep -q 'HF_HOME=/workspace/hf-cache' ~/.bashrc || cat >> ~/.bashrc << 'ENVEOF'
export HF_HOME=/workspace/hf-cache
export HUGGINGFACE_HUB_CACHE=/workspace/hf-cache/hub
export TRANSFORMERS_CACHE=/workspace/hf-cache/hub
export PIP_CACHE_DIR=/workspace/pip-cache
export XDG_CACHE_HOME=/workspace/.cache
ENVEOF

# One-time migration: if a previous run cached models on the container disk,
# move them onto the volume so "/" frees up and models don't re-download.
if [ -d /root/.cache/huggingface ] && [ ! -e /workspace/hf-cache/hub ]; then
  echo "[setup] migrating existing HF cache from container disk to /workspace…"
  mkdir -p /workspace/hf-cache
  mv /root/.cache/huggingface/* /workspace/hf-cache/ 2>/dev/null || true
fi

## 1. Install stockfish
apt-get update && apt-get install -y stockfish

# If that fails (package not found), install manually:
wget https://github.com/official-stockfish/Stockfish/releases/download/sf_16/stockfish-ubuntu-x86-64.tar
tar -xf stockfish-ubuntu-x86-64.tar
mv stockfish/stockfish-ubuntu-x86-64 /usr/local/bin/stockfish
chmod +x /usr/local/bin/stockfish

## 2. Clone repo and install deps
git clone https://github.com/infotheorylab/Covert_Chess.git
cd /Covert_Chess/backend
pip install -r requirements.txt

## 3. Fix arcmark (needs pyproject.toml — pip install -e fails otherwise)
cat > /Covert_Chess/backend/arcmark/pyproject.toml << 'EOF'
[build-system]
requires = ["setuptools>=42", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "arcmark"
version = "0.1.0"
EOF

# Set PYTHONPATH instead of pip install (more reliable)
export PYTHONPATH=/Covert_Chess/backend/arcmark:$PYTHONPATH
echo 'export PYTHONPATH=/Covert_Chess/backend/arcmark:$PYTHONPATH' >> ~/.bashrc

## 4. HuggingFace login (skip on warm restart if model already cached on /workspace)
huggingface-cli login
# Paste token from https://huggingface.co/settings/tokens
# Must have accepted Llama licence at:
# https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct
# phi-4 is ungated (no licence step), but it is ~29 GB — see the quota note in step 0.
pip install "transformers==4.46.3" "tokenizers>=0.20,<0.21"

## 5. Start server inside screen (survives terminal disconnect)
fuser -k 8000/tcp   # clear port first
screen -S bam
cd /Covert_Chess/backend
export PYTHONPATH=/Covert_Chess/backend/arcmark:$PYTHONPATH
# HF_HOME etc. are already exported via ~/.bashrc; re-export here in case this
# screen was started from a shell that predates the edit above.
export HF_HOME=/workspace/hf-cache
export HUGGINGFACE_HUB_CACHE=/workspace/hf-cache/hub
uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
# Press Ctrl+A then D to detach — server keeps running
# To reattach: screen -r bam

## 6. Get public URL
# RunPod dashboard → your pod → Connect → HTTP Service → 8000
# URL: https://XXXXXXXX-8000.proxy.runpod.net
# Test: https://XXXXXXXX-8000.proxy.runpod.net/health
# Expected: {"status":"ok","sessions":0,...}

## 7. Update GitHub Pages site with live URL
# On your LOCAL machine:
# In index.html, change the demo button href to:
#   ./demo/?backend=wss://XXXXXXXX-8000.proxy.runpod.net
# Then:
# git add . && git commit -m "update demo URL" && git push

## ── After pushing local changes, update pod ──────────────────────────
# No pod restart needed. Just:
screen -r bam
# Ctrl+C to stop uvicorn
cd /Covert_Chess && git pull
cd backend
export PYTHONPATH=/Covert_Chess/backend/arcmark:$PYTHONPATH
uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
# Note: static file changes (HTML/CSS/JS) take effect immediately without restart
# Python changes (server.py, session.py) require uvicorn restart