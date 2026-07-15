"""Runtime optimization lock contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from fuelflow.constraints.vocabulary import Constraint
from fuelflow.scenario.model import Scenario, Schedule

MAX_MOVE_LOCKS = 500
MAX_SCENARIO_LOCKS = 100
MAX_SCENARIO_LOCK_PATH_LEN = 256
MAX_CONSTRAINT_PARAM_LOCKS = 5000
GLOBAL_ENTITY_ID = "__global__"

LockMode = Literal["legacy", "enforced"]
StructureMode = Literal["locked", "unlocked"]
MoveLockField = Literal["start_min"]

ALLOWLISTED_SCENARIO_LOCK_PATHS = frozenset({"horizon_min"})

SOLVER_ENCODED_TYPES = frozenset({"temporal", "resource", "capacity"})
LOCKED_ONLY_TYPES = frozenset({"precedence"})
NOT_SOLVER_ENCODED_TYPES = frozenset({"thermal", "regulatory"})

TUNABLE_PARAMS_BY_TYPE: dict[str, list[str]] = {
    "temporal": ["earliest_min", "latest_min"],
    "regulatory": ["required_cooling_min"],
    "capacity": ["max_entities"],
    "thermal": ["max_heat_kw"],
    "resource": ["max_concurrent"],
    "precedence": [],
}


class MoveLock(BaseModel):
    entity: str
    edge: str
    occurrence_index: int = 0
    locked_fields: list[MoveLockField] = Field(default_factory=lambda: ["start_min"])


class ConstraintParamLock(BaseModel):
    entity_id: str
    constraint_id: str
    locked: bool = True


class OptimizeLockContract(BaseModel):
    lock_mode: LockMode = "legacy"
    structure_mode: StructureMode | None = None
    move_locks: list[MoveLock] = Field(default_factory=list)
    scenario_locks: list[str] = Field(default_factory=list)
    constraint_param_locks: list[ConstraintParamLock] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_contract(self) -> OptimizeLockContract:
        if self.lock_mode == "legacy":
            return self

        if self.structure_mode is None:
            raise ValueError("structure_mode is required when lock_mode is enforced")

        if len(self.move_locks) > MAX_MOVE_LOCKS:
            raise ValueError(f"move_locks exceeds limit of {MAX_MOVE_LOCKS}")

        if len(self.scenario_locks) > MAX_SCENARIO_LOCKS:
            raise ValueError(f"scenario_locks exceeds limit of {MAX_SCENARIO_LOCKS}")

        if len(self.constraint_param_locks) > MAX_CONSTRAINT_PARAM_LOCKS:
            raise ValueError(f"constraint_param_locks exceeds limit of {MAX_CONSTRAINT_PARAM_LOCKS}")

        for path in self.scenario_locks:
            if len(path) > MAX_SCENARIO_LOCK_PATH_LEN:
                raise ValueError(f"scenario lock path exceeds {MAX_SCENARIO_LOCK_PATH_LEN} characters")
            if path not in ALLOWLISTED_SCENARIO_LOCK_PATHS:
                raise ValueError(f"scenario lock path not allowlisted: {path}")

        return self

    @property
    def active(self) -> bool:
        return self.lock_mode == "enforced"


@dataclass
class LockResolution:
    effective_constraint_locks: dict[str, bool]
    unlock_warnings: list[str]
    shared_unlocked_constraint_ids: list[str]
    pair_locks: dict[tuple[str, str], bool] = field(default_factory=dict)


def default_lock_contract() -> OptimizeLockContract:
    return OptimizeLockContract(lock_mode="legacy")


def move_lock_key(entity: str, edge: str, occurrence_index: int) -> tuple[str, str, int]:
    return entity, edge, occurrence_index


def index_seed_moves(schedule: Schedule) -> list[tuple[str, str, int, float]]:
    counts: dict[tuple[str, str], int] = {}
    indexed: list[tuple[str, str, int, float]] = []
    for move in sorted(schedule.moves, key=lambda m: (m.entity, m.edge, m.start_min)):
        key = (move.entity, move.edge)
        occ = counts.get(key, 0)
        counts[key] = occ + 1
        indexed.append((move.entity, move.edge, occ, move.start_min))
    return indexed


def structure_signature(schedule: Schedule) -> list[tuple[str, str, int]]:
    return [(entity, edge, occ) for entity, edge, occ, _ in index_seed_moves(schedule)]


def _seed_move_keys(schedule: Schedule) -> dict[tuple[str, str, float, int], tuple[str, str, int]]:
    """Map (entity, edge, start_min, list_index) to index_seed_moves key (entity, edge, occ)."""
    indexed = index_seed_moves(schedule)
    by_pair: dict[tuple[str, str], list[tuple[str, str, int, float]]] = {}
    for entity, edge, occ, start in indexed:
        by_pair.setdefault((entity, edge), []).append((entity, edge, occ, start))

    keys: dict[tuple[str, str, float, int], tuple[str, str, int]] = {}
    pair_cursor: dict[tuple[str, str], int] = {}
    for list_idx, move in enumerate(schedule.moves):
        pair = (move.entity, move.edge)
        cursor = pair_cursor.get(pair, 0)
        entries = by_pair.get(pair, [])
        if cursor < len(entries):
            _, _, occ, _ = entries[cursor]
            keys[(move.entity, move.edge, move.start_min, list_idx)] = (move.entity, move.edge, occ)
            pair_cursor[pair] = cursor + 1
    return keys


def canonical_entity_move_keys(schedule: Schedule) -> dict[str, list[tuple[str, str, int]]]:
    """Per-entity execution order as (entity, edge, occ) keys; tie-break by seed list index."""
    key_map = _seed_move_keys(schedule)
    by_entity: dict[str, list[tuple[int, float, tuple[str, str, int]]]] = {}
    for list_idx, move in enumerate(schedule.moves):
        move_key = key_map.get((move.entity, move.edge, move.start_min, list_idx))
        if move_key is None:
            continue
        by_entity.setdefault(move.entity, []).append((list_idx, move.start_min, move_key))

    ordered: dict[str, list[tuple[str, str, int]]] = {}
    for entity, entries in by_entity.items():
        entries.sort(key=lambda item: (item[1], item[0]))
        ordered[entity] = [move_key for _, _, move_key in entries]
    return ordered


def node_capacity_baseline(scenario: Scenario, node_id: str) -> int | None:
    for constraint in scenario.constraints:
        if constraint.type == "capacity" and constraint.scope == "node" and constraint.target == node_id and constraint.hard:
            return int(constraint.params.get("max_entities", 0))
    return None


def locked_start_fields(contract: OptimizeLockContract) -> set[tuple[str, str, int]]:
    locked: set[tuple[str, str, int]] = set()
    for move_lock in contract.move_locks:
        if "start_min" in move_lock.locked_fields:
            locked.add(move_lock_key(move_lock.entity, move_lock.edge, move_lock.occurrence_index))
    return locked


def entity_rows(scenario: Scenario) -> list[str]:
    ids = {entity.id for entity in scenario.entities}
    ids.update(arrival.entity_id for arrival in scenario.arrivals)
    return sorted(ids)


def matrix_row_ids(scenario: Scenario) -> list[str]:
    return [GLOBAL_ENTITY_ID, *entity_rows(scenario)]


def tunable_params_for(constraint: Constraint) -> list[str]:
    return list(TUNABLE_PARAMS_BY_TYPE.get(constraint.type, []))


def _entity_nodes_for_schedule(scenario: Scenario, schedule: Schedule | None, entity_id: str) -> set[str]:
    nodes: set[str] = set()
    for entity in scenario.entities:
        if entity.id == entity_id:
            nodes.add(entity.location)
    if schedule:
        edge_map = scenario.topology.edge_map()
        for move in schedule.moves:
            if move.entity != entity_id:
                continue
            edge = edge_map.get(move.edge)
            if edge:
                nodes.add(edge.from_node)
                nodes.add(edge.to_node)
    return nodes


def _entity_resources_for_schedule(scenario: Scenario, schedule: Schedule | None, entity_id: str) -> set[str]:
    resources: set[str] = set()
    if not schedule:
        return resources
    edge_map = scenario.topology.edge_map()
    for move in schedule.moves:
        if move.entity != entity_id:
            continue
        edge = edge_map.get(move.edge)
        if edge:
            resources.update(edge.requires)
    return resources


def _entity_in_precedence(scenario: Scenario, schedule: Schedule | None, entity_id: str, constraint: Constraint) -> bool:
    before = str(constraint.params.get("before_move", ""))
    after = str(constraint.params.get("after_move", ""))
    if entity_id in before or entity_id in after:
        return True
    if not schedule:
        return False
    entity_edges = {move.edge for move in schedule.moves if move.entity == entity_id}
    return any(edge in before or edge in after for edge in entity_edges)


def constraint_applicability(
    scenario: Scenario,
    schedule: Schedule | None,
    entity_id: str,
    constraint: Constraint,
) -> bool:
    if entity_id == GLOBAL_ENTITY_ID:
        return True

    if constraint.type in {"temporal", "regulatory"} and constraint.scope == "global":
        return False

    if constraint.type == "precedence":
        return _entity_in_precedence(scenario, schedule, entity_id, constraint)

    if constraint.type == "resource":
        return constraint.target in _entity_resources_for_schedule(scenario, schedule, entity_id)

    if constraint.type in {"capacity", "thermal"} and constraint.scope == "node":
        return constraint.target in _entity_nodes_for_schedule(scenario, schedule, entity_id)

    if constraint.scope == "global":
        return False

    return entity_id in entity_rows(scenario)


def validate_constraint_param_locks(
    contract: OptimizeLockContract,
    scenario: Scenario,
    schedule: Schedule | None,
) -> None:
    if not contract.active:
        return
    constraint_ids = {c.id for c in scenario.constraints}
    rows = set(matrix_row_ids(scenario))
    max_pairs = len(rows) * max(len(constraint_ids), 1)
    if len(contract.constraint_param_locks) > max_pairs:
        raise ValueError(f"constraint_param_locks exceeds matrix size {max_pairs}")

    for lock in contract.constraint_param_locks:
        if lock.entity_id not in rows:
            raise ValueError(f"unknown entity_id in constraint_param_locks: {lock.entity_id}")
        if lock.constraint_id not in constraint_ids:
            raise ValueError(f"unknown constraint_id in constraint_param_locks: {lock.constraint_id}")
        constraint = next(c for c in scenario.constraints if c.id == lock.constraint_id)
        if not constraint_applicability(scenario, schedule, lock.entity_id, constraint):
            raise ValueError(
                f"constraint_param_locks pair not applicable: {lock.entity_id}/{lock.constraint_id}",
            )


def _pair_lock_map(
    contract: OptimizeLockContract,
    scenario: Scenario,
    schedule: Schedule | None,
) -> dict[tuple[str, str], bool]:
    """Sparse payload: missing applicable pairs default to locked."""
    explicit = {(lock.entity_id, lock.constraint_id): lock.locked for lock in contract.constraint_param_locks}
    pairs: dict[tuple[str, str], bool] = {}
    for entity_id in matrix_row_ids(scenario):
        for constraint in scenario.constraints:
            if not constraint_applicability(scenario, schedule, entity_id, constraint):
                continue
            pairs[(entity_id, constraint.id)] = explicit.get((entity_id, constraint.id), True)
    return pairs


def resolve_lock_state(
    contract: OptimizeLockContract,
    scenario: Scenario,
    schedule: Schedule | None,
) -> LockResolution:
    if not contract.active:
        return LockResolution(effective_constraint_locks={}, unlock_warnings=[], shared_unlocked_constraint_ids=[])

    pair_locks = _pair_lock_map(contract, scenario, schedule)
    effective: dict[str, bool] = {}
    warnings: list[str] = []
    shared_unlocked: list[str] = []

    for constraint in scenario.constraints:
        global_key = (GLOBAL_ENTITY_ID, constraint.id)
        globally_unlocked = global_key in pair_locks and not pair_locks[global_key]
        entity_unlocked = any(
            not locked
            for (entity_id, constraint_id), locked in pair_locks.items()
            if constraint_id == constraint.id and entity_id != GLOBAL_ENTITY_ID
        )
        is_unlocked = globally_unlocked or entity_unlocked
        effective[constraint.id] = not is_unlocked
        if is_unlocked:
            shared_unlocked.append(constraint.id)
            if constraint.type in LOCKED_ONLY_TYPES:
                warnings.append(f"precedence_locked_only:{constraint.id}")
            elif constraint.type in NOT_SOLVER_ENCODED_TYPES:
                warnings.append(f"constraint_unlock_not_solver_encoded:{constraint.id}")

    return LockResolution(
        effective_constraint_locks=effective,
        unlock_warnings=sorted(set(warnings)),
        shared_unlocked_constraint_ids=sorted(shared_unlocked),
        pair_locks=pair_locks,
    )


def resolve_effective_constraint_locks(
    contract: OptimizeLockContract,
    scenario: Scenario,
    schedule: Schedule | None,
) -> dict[str, bool]:
    return resolve_lock_state(contract, scenario, schedule).effective_constraint_locks


def default_locked_matrix(scenario: Scenario, schedule: Schedule | None) -> list[ConstraintParamLock]:
    locks: list[ConstraintParamLock] = []
    for entity_id in matrix_row_ids(scenario):
        for constraint in scenario.constraints:
            if constraint_applicability(scenario, schedule, entity_id, constraint):
                locks.append(ConstraintParamLock(entity_id=entity_id, constraint_id=constraint.id, locked=True))
    return locks


def resource_baseline_capacity(scenario: Scenario, resource_id: str) -> int:
    for constraint in scenario.constraints:
        if constraint.type == "resource" and constraint.target == resource_id:
            return int(constraint.params.get("max_concurrent", 1))
    for resource in scenario.resources:
        if resource.id == resource_id:
            return int(resource.capacity)
    return 1


def lock_capabilities(scenario: Scenario | None = None, schedule: Schedule | None = None) -> dict[str, object]:
    base: dict[str, object] = {
        "scenario_tunable_active": False,
        "allowlisted_scenario_paths": sorted(ALLOWLISTED_SCENARIO_LOCK_PATHS),
        "move_fields": ["start_min"],
        "global_entity_id": GLOBAL_ENTITY_ID,
        "solver_encoded_types": sorted(SOLVER_ENCODED_TYPES),
        "locked_only_types": sorted(LOCKED_ONLY_TYPES),
    }
    if scenario is None:
        return base

    constraints = [{"id": c.id, "type": c.type, "scope": c.scope, "target": c.target} for c in scenario.constraints]
    applicability: dict[str, dict[str, bool]] = {}
    tunable: dict[str, list[str]] = {}
    for entity_id in matrix_row_ids(scenario):
        applicability[entity_id] = {}
        for constraint in scenario.constraints:
            applicable = constraint_applicability(scenario, schedule, entity_id, constraint)
            applicability[entity_id][constraint.id] = applicable
            if applicable and constraint.id not in tunable:
                tunable[constraint.id] = tunable_params_for(constraint)

    shared_ids = [c.id for c in scenario.constraints if c.type in {"capacity", "thermal", "resource", "temporal", "regulatory"}]
    locked_only_ids = [c.id for c in scenario.constraints if c.type in LOCKED_ONLY_TYPES]
    solver_encoded_ids = [c.id for c in scenario.constraints if c.type in SOLVER_ENCODED_TYPES]

    base.update(
        {
            "entities": entity_rows(scenario),
            "constraints": constraints,
            "applicability": applicability,
            "tunable_params_by_constraint": tunable,
            "shared_constraint_ids": shared_ids,
            "locked_only_constraint_ids": locked_only_ids,
            "solver_encoded_constraint_ids": solver_encoded_ids,
        },
    )
    return base
