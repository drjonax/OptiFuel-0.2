"""Safe YAML I/O with atomic writes and path constraints."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

import yaml

from fuelflow.io.canonical import digest

MAX_YAML_BYTES = 5 * 1024 * 1024


class YamlIOError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def _safe_load(stream: str) -> Any:
    return yaml.safe_load(stream)


def load_yaml(path: Path) -> Any:
    if not path.exists():
        raise YamlIOError("not_found", f"File not found: {path}")
    if path.is_symlink():
        raise YamlIOError("symlink_rejected", f"Symlink rejected: {path}")
    raw = path.read_bytes()
    if len(raw) > MAX_YAML_BYTES:
        raise YamlIOError("payload_too_large", f"YAML exceeds {MAX_YAML_BYTES} bytes")
    return _safe_load(raw.decode("utf-8"))


def _resolve_under_root(path: Path, root: Path) -> Path:
    root = root.resolve()
    candidate = (root / path).resolve() if not path.is_absolute() else path.resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise YamlIOError("path_escape", f"Path escapes workspace root: {path}") from exc
    if candidate.is_symlink():
        raise YamlIOError("symlink_rejected", f"Symlink rejected: {candidate}")
    return candidate


def save_yaml(
    path: Path,
    data: Any,
    *,
    root: Path,
    expected_digest: str | None = None,
) -> str:
    target = _resolve_under_root(path, root)
    target.parent.mkdir(parents=True, exist_ok=True)

    if expected_digest is not None and target.exists():
        current = load_yaml(target)
        current_digest = digest(current)
        if current_digest != expected_digest:
            raise YamlIOError(
                "stale_write",
                f"Stale write rejected for {target}: expected {expected_digest}, got {current_digest}",
            )

    serialized = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
        dir_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise

    return digest(data)


def cleanup_orphan_temps(root: Path) -> int:
    removed = 0
    for tmp in root.rglob("*.tmp"):
        tmp.unlink(missing_ok=True)
        removed += 1
    return removed
