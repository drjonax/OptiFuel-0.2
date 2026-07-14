"""Scenario and schedule domain models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from fuelflow.constraints.vocabulary import Constraint
from fuelflow.entities.models import Entity
from fuelflow.physics.decay import PhysicsConfig
from fuelflow.resources.models import Resource, UnitMode
from fuelflow.topology.models import Topology

RuntimeMode = Literal["fail_fast", "continue_and_report"]


class Arrival(BaseModel):
    entity_id: str
    node_id: str
    t_min: float
    state: dict[str, Any] = Field(default_factory=dict)


class Departure(BaseModel):
    entity_id: str
    node_id: str
    t_min: float


class ObjectiveTerm(BaseModel):
    metric: str
    weight: float
    normalise: dict[str, Any]


class ObjectiveConfig(BaseModel):
    terms: list[ObjectiveTerm] = Field(default_factory=list)


class Scenario(BaseModel):
    schema_version: int = 4
    id: str
    horizon_min: float
    topology: Topology
    entities: list[Entity]
    resources: list[Resource]
    unit_modes: list[UnitMode] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    physics: PhysicsConfig = Field(default_factory=PhysicsConfig)
    arrivals: list[Arrival] = Field(default_factory=list)
    departures: list[Departure] = Field(default_factory=list)
    objective: ObjectiveConfig = Field(default_factory=ObjectiveConfig)
    lineage_parent_id: str | None = None
    forked_at_min: float | None = None

    def model_dump_canonical(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


class Move(BaseModel):
    entity: str
    edge: str
    start_min: float = Field(alias="start")

    model_config = {"populate_by_name": True}


class Schedule(BaseModel):
    schema_version: int = 4
    scenario: str
    moves: list[Move] = Field(default_factory=list)

    def model_dump_canonical(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)
