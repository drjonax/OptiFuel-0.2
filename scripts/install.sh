#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> OptiFuel first-time install"
echo "    Root: $ROOT"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not found in PATH." >&2
    exit 1
  fi
}

require_cmd python3
require_cmd npm

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="$ROOT/.venv"

echo "==> Creating Python virtual environment"
if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"

echo "==> Installing Python dependencies"
python -m pip install --upgrade pip
pip install -e ".[dev]"

echo "==> Installing workbench dependencies"
(cd "$ROOT/workbench" && npm install)

echo ""
echo "Install complete."
echo ""
echo "Next steps:"
echo "  ./scripts/start.sh"
echo ""
echo "Or run components separately:"
echo "  source .venv/bin/activate && optifuel serve"
echo "  cd workbench && npm run dev"
