#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_HOST="${OPTIFUEL_API_HOST:-127.0.0.1}"
API_PORT="${OPTIFUEL_API_PORT:-8000}"
UI_HOST="${OPTIFUEL_UI_HOST:-127.0.0.1}"
UI_PORT="${OPTIFUEL_UI_PORT:-5173}"

VENV_DIR="$ROOT/.venv"
API_PID=""
UI_PID=""

cleanup() {
  local exit_code=$?
  echo ""
  echo "==> Shutting down OptiFuel"
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$UI_PID" ]] && kill -0 "$UI_PID" 2>/dev/null; then
    kill "$UI_PID" 2>/dev/null || true
    wait "$UI_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [[ ! -d "$VENV_DIR" ]] || [[ ! -x "$VENV_DIR/bin/optifuel" ]]; then
  echo "Error: backend not installed. Run ./scripts/install.sh first." >&2
  exit 1
fi

if [[ ! -d "$ROOT/workbench/node_modules" ]]; then
  echo "Error: workbench not installed. Run ./scripts/install.sh first." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

export OPTIFUEL_WORKSPACE="$ROOT"

echo "==> Starting OptiFuel"
echo "    API:       http://${API_HOST}:${API_PORT}"
echo "    Workbench: http://${UI_HOST}:${UI_PORT}"
echo ""
echo "Press Ctrl+C to stop both services."
echo ""

optifuel serve --host "$API_HOST" --port "$API_PORT" &
API_PID=$!

(
  cd "$ROOT/workbench"
  npm run dev -- --host "$UI_HOST" --port "$UI_PORT"
) &
UI_PID=$!

# Bash 3.2 (macOS default) lacks `wait -n`; poll until either child exits.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$UI_PID" 2>/dev/null; do
  sleep 1
done
echo "One of the services exited unexpectedly." >&2
exit 1
