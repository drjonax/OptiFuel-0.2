"""Scenario validation registry."""

from __future__ import annotations

from fuelflow.constraints.vocabulary import ALLOWED_CONSTRAINT_TYPES
from fuelflow.scenario.model import Scenario, Schedule


class ValidationIssue:
    def __init__(self, rule_id: str, severity: str, message: str) -> None:
        self.rule_id = rule_id
        self.severity = severity
        self.message = message


def validate_scenario(scenario: Scenario) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    if scenario.schema_version != 4:
        issues.append(ValidationIssue("V-01", "error", "schema_version must be 4"))

    node_ids = {n.id for n in scenario.topology.nodes}
    edge_ids = {e.id for e in scenario.topology.edges}
    resource_ids = {r.id for r in scenario.resources}
    entity_ids = {e.id for e in scenario.entities}

    allowed_node_types = {"fresh_store", "corridor_staging", "core", "interim_pool", "lts"}
    for node in scenario.topology.nodes:
        if node.type not in allowed_node_types:
            issues.append(ValidationIssue("V-02", "error", f"Invalid node type: {node.type}"))

    for edge in scenario.topology.edges:
        if edge.from_node not in node_ids:
            issues.append(ValidationIssue("V-03", "error", f"Edge {edge.id} from unknown node"))
        if edge.to_node not in node_ids:
            issues.append(ValidationIssue("V-03", "error", f"Edge {edge.id} to unknown node"))
        for req in edge.requires:
            if req not in resource_ids:
                issues.append(ValidationIssue("V-03", "error", f"Edge {edge.id} requires unknown resource {req}"))

    unit_ids = {
        node.unit
        for node in scenario.topology.nodes
        if node.unit not in {None, "shared"}
    } | {mode.unit for mode in scenario.unit_modes}

    for entity in scenario.entities:
        if entity.location not in node_ids and entity.location not in resource_ids:
            issues.append(ValidationIssue("V-03", "error", f"Entity {entity.id} at unknown location"))
        if entity.location in resource_ids:
            resource = next(r for r in scenario.resources if r.id == entity.location)
            if not resource.holds_entities:
                issues.append(ValidationIssue("V-11", "error", f"Entity {entity.id} on non-holding resource"))
        if entity.home_unit is not None and entity.home_unit not in unit_ids:
            issues.append(
                ValidationIssue(
                    "V-13",
                    "error",
                    f"Entity {entity.id} home_unit references unknown unit {entity.home_unit}",
                ),
            )

    for constraint in scenario.constraints:
        if constraint.type not in ALLOWED_CONSTRAINT_TYPES:
            issues.append(ValidationIssue("V-02", "error", f"Unknown constraint type: {constraint.type}"))

    for arrival in scenario.arrivals:
        if arrival.node_id not in node_ids:
            issues.append(ValidationIssue("V-05", "error", f"Arrival node unknown: {arrival.node_id}"))
        if arrival.entity_id in entity_ids:
            issues.append(ValidationIssue("V-05", "error", f"Arrival entity already exists: {arrival.entity_id}"))

    for departure in scenario.departures:
        if departure.entity_id not in entity_ids:
            issues.append(ValidationIssue("V-05", "error", f"Departure entity unknown: {departure.entity_id}"))

    for model in scenario.physics.decay_models:
        if not model.table:
            issues.append(ValidationIssue("V-10", "error", f"Decay table missing for {model.entity_id}"))

    if scenario.horizon_min <= 0:
        issues.append(ValidationIssue("V-04", "error", "horizon_min must be positive"))

    for resource in scenario.resources:
        for idx, window in enumerate(resource.calendar):
            start = float(window.from_min)
            end = float(window.to_min)
            if start < 0 or end < 0:
                issues.append(
                    ValidationIssue(
                        "V-12",
                        "error",
                        f"Resource {resource.id} calendar window {idx} has negative bounds",
                    ),
                )
            if start >= end:
                issues.append(
                    ValidationIssue(
                        "V-12",
                        "error",
                        f"Resource {resource.id} calendar window {idx} requires from < to",
                    ),
                )
            if end > scenario.horizon_min:
                issues.append(
                    ValidationIssue(
                        "V-12",
                        "error",
                        f"Resource {resource.id} calendar window {idx} exceeds horizon",
                    ),
                )

    return issues


def validate_schedule(schedule: Schedule, scenario: Scenario) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    if schedule.schema_version != 4:
        issues.append(ValidationIssue("V-01", "error", "schedule schema_version must be 4"))
    if schedule.scenario != scenario.id:
        issues.append(ValidationIssue("V-03", "error", "schedule.scenario mismatch"))

    entity_ids = {e.id for e in scenario.entities} | {a.entity_id for a in scenario.arrivals}
    edge_ids = {e.id for e in scenario.topology.edges}

    for move in schedule.moves:
        if move.entity not in entity_ids:
            issues.append(ValidationIssue("V-03", "error", f"Move references unknown entity {move.entity}"))
        if move.edge not in edge_ids:
            issues.append(ValidationIssue("V-03", "error", f"Move references unknown edge {move.edge}"))
        if move.start_min < 0 or move.start_min > scenario.horizon_min:
            issues.append(ValidationIssue("V-10", "error", f"Move start {move.start_min} outside horizon"))

    return issues


def has_errors(issues: list[ValidationIssue]) -> bool:
    return any(i.severity == "error" for i in issues)
