#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3000 ist schon belegt. Im bisherigen App-Terminal Ctrl+C drücken und dann nochmals starten."
  exit 1
fi
if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null; then
  brew services start ollama
  for attempt in {1..15}; do
    if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null; then break; fi
    sleep 1
  done
fi
echo "Die App startet auf http://localhost:3000. Dieses Fenster geöffnet lassen."
(sleep 2; open http://localhost:3000) &
exec caffeinate -i npm start
