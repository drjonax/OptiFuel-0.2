"""Canonical serialization and digest utilities."""

from __future__ import annotations

import hashlib
import json
from typing import Any

VOLATILE_FIELDS = frozenset({
    "created_at",
    "wall_clock_ts",
    "run_id",
    "request_id",
})


def canonical_json(data: Any, *, exclude_volatile: bool = False) -> str:
    """Serialize to canonical JSON for deterministic digests."""

    def _normalize(obj: Any) -> Any:
        if isinstance(obj, dict):
            items = []
            for key in sorted(obj.keys()):
                if exclude_volatile and key in VOLATILE_FIELDS:
                    continue
                items.append((key, _normalize(obj[key])))
            return {k: v for k, v in items}
        if isinstance(obj, list):
            return [_normalize(item) for item in obj]
        if isinstance(obj, float):
            return round(obj, 10)
        return obj

    normalized = _normalize(data)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(data: Any, *, exclude_volatile: bool = False) -> str:
    payload = canonical_json(data, exclude_volatile=exclude_volatile)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
