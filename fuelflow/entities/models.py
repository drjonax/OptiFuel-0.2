"""Entity layer: assembly identity and state."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EntityState(BaseModel):
    burnup_mwd_kgu: float = 0.0
    discharge_time_min: float | None = None
    heat_kw: float = 0.0


class Entity(BaseModel):
    id: str
    location: str
    position: int | None = None
    state: EntityState = Field(default_factory=EntityState)
    history: list[dict[str, Any]] = Field(default_factory=list)
