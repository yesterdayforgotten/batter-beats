#!/bin/sh
# Keeps the development server running on port 8090, restarting it if it stops.
# Started by the container (see "Dev environment notes" in PLAN.md).
cd "$(dirname "$0")/.." || exit 1
while true; do
  echo "$(date -u +%FT%TZ) starting dev server" >> dev-server.log
  npm run dev >> dev-server.log 2>&1
  echo "$(date -u +%FT%TZ) dev server stopped; restarting in 5 seconds" >> dev-server.log
  sleep 5
done
