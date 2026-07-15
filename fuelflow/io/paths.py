"""Workspace path helpers shared by API, CLI, and workbench conventions."""

from __future__ import annotations

from pathlib import Path


def sibling_schedule_path(scenario_path: str | Path) -> str:
    """Mirror workbench `siblingSchedulePath`: `<dir>/schedule.yaml` next to scenario."""
    normalized = str(scenario_path).replace("\\", "/")
    if normalized.endswith("/scenario.yaml"):
        return normalized[: -len("scenario.yaml")] + "schedule.yaml"
    last_slash = normalized.rfind("/")
    if last_slash >= 0:
        return f"{normalized[:last_slash]}/schedule.yaml"
    return "schedule.yaml"


def resolve_seed_schedule_path(
    scenario_path: Path,
    workspace: Path,
    *,
    explicit_seed_path: Path | None = None,
) -> Path:
    """Resolve seed schedule: explicit path first, else sibling schedule.yaml."""
    if explicit_seed_path is not None:
        return explicit_seed_path if explicit_seed_path.is_absolute() else workspace / explicit_seed_path

    scenario_abs = scenario_path if scenario_path.is_absolute() else workspace / scenario_path
    try:
        rel = scenario_abs.relative_to(workspace)
    except ValueError:
        rel = scenario_abs
    sibling = sibling_schedule_path(rel)
    return workspace / sibling
