#!/bin/bash
# Start-up for the development container (see Dockerfile.dev): starts the dev
# server in the background, then keeps a Claude Code session running.
export HOME=/home/node
export PATH="$HOME/.local/bin:$PATH"

# Claude installs into the mounted home folder, so this only runs the very first time.
if ! command -v claude >/dev/null; then
  curl -fsSL https://claude.ai/install.sh | bash
fi

cd /workspace
if [ -f package.json ]; then
  [ -d node_modules ] || npm ci
  setsid scripts/dev-server.sh > /dev/null 2>&1 < /dev/null &
fi

while true; do
  # Reopen the most recent conversation in /workspace so its history carries over.
  # The very first time there is none, so start a new one instead.
  claude --continue --remote-control "Batter Beats" --permission-mode acceptEdits \
    || claude --remote-control "Batter Beats" --permission-mode acceptEdits \
    || true
  echo "Claude stopped. If this repeats, open Attach in Portainer to see why. Retrying in 30 seconds."
  sleep 30
done
