#!/bin/bash
set -euo pipefail

# Ensure Ollama local models can be accessed without auth errors
export OLLAMA_API_KEY="ollama-local"
# Find the absolute path to the ErnOS directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Kill any existing ErnOS gateway processes
GATEWAY_PORT="${ERNOS_GATEWAY_PORT:-18789}"
EXISTING_PIDS=$(lsof -ti :"$GATEWAY_PORT" 2>/dev/null || true)
if [ -n "$EXISTING_PIDS" ]; then
  echo "🧹 Killing existing processes on port $GATEWAY_PORT..."
  echo "$EXISTING_PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Also kill any lingering ernos-gateway processes
pkill -f "ernos-gateway\|ernos.mjs gateway" 2>/dev/null || true

# ─── Sandbox Workspace for Self-Modification ────────────────────────────────
# Creates a read-write clone of the codebase that ErnOS can freely edit/test
# without touching the live running code.
SANDBOX_DIR="$HOME/.ernos/sandbox"
echo "🔧 Syncing sandbox workspace to $SANDBOX_DIR..."
mkdir -p "$SANDBOX_DIR"
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='memory/' \
  --exclude='.cache' \
  --exclude='.pnpm-store' \
  "$DIR/" "$SANDBOX_DIR/"

# Symlink node_modules into sandbox to save disk space
if [ ! -e "$SANDBOX_DIR/node_modules" ]; then
  ln -s "$DIR/node_modules" "$SANDBOX_DIR/node_modules"
fi

echo "✅ Sandbox ready at $SANDBOX_DIR"

echo "🌱 Starting ErnOS..."

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install || npm install || echo "Dependency install failed, attempting to run anyway..."
fi

# Default to starting the gateway if no arguments provided
if [ $# -eq 0 ]; then
  ARGS="gateway --allow-unconfigured"
else
  ARGS="$@"
fi

if [ -f "ernos.mjs" ]; then
  pnpm start $ARGS 2>&1 | tee ~/.ernos/logs/ernOS-live.log || node ./ernos.mjs $ARGS 2>&1 | tee ~/.ernos/logs/ernOS-live.log
else
  echo "Error: ErnOS entrypoint not found."
  exit 1
fi
