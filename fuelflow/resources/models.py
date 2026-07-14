"""Resource layer: shared capacities and unit modes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ResourceType = Literal["fhm", "corridor_transit", "crew", "cask", "other"]
UnitModeType = Literal["power", "shutdown", "refueling"]


class CalendarWindow(BaseModel):
    from_min: float = Field(alias="from")
    to_min: float = Field(alias="to")
    mode: str | None = None

    model_config = {"populate_by_name": True}


class Resource(BaseModel):
    id: str
    type: ResourceType
    capacity: int = 1
    calendar: list[CalendarWindow] = Field(default_factory=list)
    shared_by: list[str] = Field(default_factory=list)
    holds_entities: bool = False


class UnitModeWindow(BaseModel):
    from_min: float = Field(alias="from")
    to_min: float = Field(alias="to")
    mode: UnitModeType

    model_config = {"populate_by_name": True}


class UnitMode(BaseModel):
    unit: str
    windows: list[UnitModeWindow]
