"""Topology layer: nodes and edges."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NodeType = Literal["fresh_store", "corridor_staging", "core", "interim_pool", "lts"]
BoundaryType = Literal["none", "source", "sink"]


class GeometryPosition(BaseModel):
    id: int
    coord_mm: list[float]


class NodeGeometry(BaseModel):
    positions: list[GeometryPosition] = Field(default_factory=list)


class Node(BaseModel):
    id: str
    type: NodeType
    unit: str = "shared"
    boundary: BoundaryType = "none"
    geometry: NodeGeometry | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class EdgeDuration(BaseModel):
    base_min: float
    modifiers: list[dict[str, Any]] = Field(default_factory=list)


class Edge(BaseModel):
    id: str
    from_node: str = Field(alias="from")
    to_node: str = Field(alias="to")
    requires: list[str] = Field(default_factory=list)
    duration_min: EdgeDuration

    model_config = {"populate_by_name": True}


class Topology(BaseModel):
    nodes: list[Node]
    edges: list[Edge]

    def node_map(self) -> dict[str, Node]:
        return {n.id: n for n in self.nodes}

    def edge_map(self) -> dict[str, Edge]:
        return {e.id: e for e in self.edges}
