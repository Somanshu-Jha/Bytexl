#!/usr/bin/env bash
# Sehat - single-command launcher for macOS and Linux.
# Starts the local API and the interface, waits until both answer, then opens the browser.
# Everything runs on loopback (127.0.0.1) only.

set -u
cd "$(dirname "$0")" || exit 1

API_PORT="${PORT:-3001}"
WEB_PORT=5173

echo
echo "  sehat.  Starting your health record workspace"
echo "  ============================================"
echo

# ---------- 1. Node.js present and new enough ----------
if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js not found."
  echo "      Install Node 24 or newer from https://nodejs.org/ then run this again."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ] 2>/dev/null; then
  echo "  [X] Node.js $NODE_MAJOR found, but Sehat needs Node 24 or newer."
  echo "      Node 24 includes the built-in SQLite that stores your records."
  echo "      Current version: $(node --version)"
  exit 1
fi
echo "  [1/6] Node.js $(node --version) ............... ready"

if ! command -v npm >/dev/null 2>&1; then
  echo "  [X] npm not found. Reinstall Node.js from https://nodejs.org/."
  exit 1
fi

# ---------- 2. Dependencies ----------
if [ ! -d node_modules ]; then
  echo "  [2/6] First run - installing dependencies..."
  echo "        This downloads packages once and can take a few minutes."
  if ! npm install; then
    echo "  [X] npm install failed. Check your internet connection and try again."
    exit 1
  fi
  echo "        Dependencies installed."
else
  echo "  [2/6] Dependencies ................. ready"
fi

# ---------- 3. Configuration ----------
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env
  echo "  [3/6] Created .env from the example."
  echo "        Add NVIDIA_API_KEY to enable AI reading of images and scanned PDFs."
  echo "        Without a key the app still runs: browse, edit and read text reports."
elif grep -qE '^NVIDIA_API_KEY=.+' .env 2>/dev/null; then
  echo "  [3/6] Config ....................... NVIDIA key found"
else
  echo "  [3/6] Config ....................... no NVIDIA key"
  echo "        Text reports work locally. Images and scanned PDFs need a key in .env."
fi

# ---------- 4. Free the ports if a previous run left them busy ----------
freed=0
for port in "$API_PORT" "$WEB_PORT"; do
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "  [4/6] Port $port busy - stopping old process $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    freed=1
  fi
done
[ "$freed" -eq 0 ] && echo "  [4/6] Ports $API_PORT and $WEB_PORT ......... free"
sleep 2

# ---------- 5. Build the interface if it has never been built ----------
if [ ! -f dist/index.html ]; then
  echo "  [5/6] Building the interface for the first time..."
  if ! npm run build; then
    echo "  [X] Build failed. Run 'npm run build' to see the full error."
    exit 1
  fi
  echo "        Build complete."
else
  echo "  [5/6] Interface build .............. ready"
fi

# ---------- 6. Start both services ----------
echo "  [6/6] Starting services..."
echo

export SEHAT_DEV_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT"

# Stop both children together when this script is interrupted.
api_pid=""
web_pid=""
cleanup() {
  echo
  echo "  Stopping Sehat..."
  [ -n "$web_pid" ] && kill "$web_pid" 2>/dev/null || true
  [ -n "$api_pid" ] && kill "$api_pid" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

node --env-file-if-exists=.env server/index.mjs &
api_pid=$!

npx vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort &
web_pid=$!

echo "  Waiting for the workspace to answer..."
ready=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$WEB_PORT/api/health" 2>/dev/null; then
    ready=1
    break
  fi
  # If either child died, stop waiting immediately rather than looking like a hang.
  if ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$web_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done

echo
if [ "$ready" -eq 1 ]; then
  echo "  Sehat is ready at http://localhost:$WEB_PORT"
  echo "  Opening the browser... (press Ctrl+C here to stop)"
  echo
  if command -v open >/dev/null 2>&1; then open "http://localhost:$WEB_PORT"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$WEB_PORT" >/dev/null 2>&1
  else echo "  Open http://localhost:$WEB_PORT in your browser."
  fi
  wait
else
  echo "  [!] The workspace did not answer within 60 seconds."
  echo "      Scroll up for the error from the API or the interface."
  echo "      Check that port $API_PORT is free, then run this script again."
  cleanup
  exit 1
fi
