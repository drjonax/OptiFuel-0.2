/** Derive and patch optimiser-aligned baseline fields in v0.2 scenario/schedule data. */

import {
  collectUnitIds,
  edgeUnitFromId,
  entityHasConflictingUnitMoves,
} from "./scenarioHelpers";
import { setFhmCount, type ScenarioMutationResult } from "./scenarioMutations";

type TopologyNode = { id: string; unit?: string; type?: string };
type TopologyEdge = {
  id: string;
  duration_min?: { base_min?: number; modifiers?: unknown[] };
};
type EntityRecord = {
  id: string;
  home_unit?: string | null;
  state?: { heat_kw?: number; burnup_mwd_kgu?: number; discharge_time_min?: number | null };
};
type UnitModeRecord = {
  unit: string;
  windows: Array<{ from?: number; to?: number; mode?: string }>;
};
type ConstraintRecord = {
  id: string;
  type?: string;
  params?: Record<string, unknown>;
};
type ResourceRecord = { id: string; type: string; capacity?: number };
type ScheduleMove = { entity?: string; edge?: string; start?: number };

export type StartingConditionRow = {
  unitId: string;
  entityId: string;
  refuelingFrom: number;
  refuelingTo: number;
  scheduleStartMin: number;
  heatKw: number;
  homeUnitBlocked: boolean;
};

export type GlobalParameterRow = {
  id: string;
  label: string;
  group: "timing" | "capacity" | "thermal";
  value: number;
  unit: string;
  editable: boolean;
};

export { collectUnitIds };

function entityUnitFromSchedule(
  entityId: string,
  moves: ScheduleMove[],
  unitIds: string[],
): string | null {
  for (const move of moves.filter((entry) => entry.entity === entityId)) {
    if (!move.edge) continue;
    const unit = edgeUnitFromId(move.edge, unitIds);
    if (unit) return unit;
  }
  return null;
}

export function deriveStartingConditions(
  scenario: Record<string, unknown>,
  schedule: Record<string, unknown> | null,
): StartingConditionRow[] {
  const unitIds = collectUnitIds(scenario);
  const entities = (scenario.entities as EntityRecord[] | undefined) ?? [];
  const unitModes = (scenario.unit_modes as UnitModeRecord[] | undefined) ?? [];
  const moves = (schedule?.moves as ScheduleMove[] | undefined) ?? [];

  return entities.map((entity) => {
    const mappedUnit =
      entity.home_unit ??
      entityUnitFromSchedule(entity.id, moves, unitIds) ??
      "—";

    const mode = unitModes.find((entry) => entry.unit === mappedUnit);
    const window = mode?.windows?.[0];
    const entityMoves = moves.filter((move) => move.entity === entity.id);
    const scheduleStartMin =
      entityMoves.length > 0
        ? Math.min(...entityMoves.map((move) => Number(move.start ?? 0)))
        : 0;

    const homeUnitBlocked =
      mappedUnit !== "—" &&
      entityHasConflictingUnitMoves(schedule, entity.id, mappedUnit, unitIds);

    return {
      unitId: mappedUnit,
      entityId: entity.id,
      refuelingFrom: Number(window?.from ?? 0),
      refuelingTo: Number(window?.to ?? scenario.horizon_min ?? 0),
      scheduleStartMin,
      heatKw: Number(entity.state?.heat_kw ?? 0),
      homeUnitBlocked,
    };
  });
}

export function deriveGlobalParameters(scenario: Record<string, unknown>): GlobalParameterRow[] {
  const edges = (scenario.topology as { edges?: TopologyEdge[] } | undefined)?.edges ?? [];
  const constraints = (scenario.constraints as ConstraintRecord[] | undefined) ?? [];
  const resources = (scenario.resources as ResourceRecord[] | undefined) ?? [];

  const edgeDuration = (edgeId: string): number => {
    const edge = edges.find((entry) => entry.id === edgeId);
    return Number(edge?.duration_min?.base_min ?? 0);
  };
  const constraintParam = (id: string, key: string): number => {
    const constraint = constraints.find((entry) => entry.id === id);
    return Number(constraint?.params?.[key] ?? 0);
  };
  const resourceCapacity = (type: string): number => {
    const matches = resources.filter((resource) => resource.type === type);
    if (matches.length === 0) return 0;
    return Number(matches[0]?.capacity ?? 0);
  };
  const fhmCount = resources.filter((resource) => resource.type === "fhm").length;

  return [
    {
      id: "horizon_min",
      label: "horizon_min",
      group: "timing",
      value: Number(scenario.horizon_min ?? 0),
      unit: "min",
      editable: true,
    },
    {
      id: "corridorTransitMin",
      label: "corridorTransitMin",
      group: "timing",
      value: edgeDuration("fresh_to_staging"),
      unit: "min",
      editable: true,
    },
    {
      id: "fhmCycleMin",
      label: "fhmCycleMin",
      group: "timing",
      value: edgeDuration("staging_to_core_u1") || edgeDuration("staging_to_core_u2"),
      unit: "min",
      editable: true,
    },
    {
      id: "coolingDwellMin",
      label: "coolingDwellMin",
      group: "timing",
      value: edgeDuration("pool_u1_to_lts") || edgeDuration("pool_u2_to_lts"),
      unit: "min",
      editable: true,
    },
    {
      id: "required_cooling_min",
      label: "required_cooling_min",
      group: "timing",
      value: constraintParam("regulatory_cooling", "required_cooling_min"),
      unit: "min",
      editable: true,
    },
    {
      id: "fhmCount",
      label: "fhmCount",
      group: "capacity",
      value: fhmCount,
      unit: "count",
      editable: true,
    },
    {
      id: "corridorCapacity",
      label: "corridorCapacity",
      group: "capacity",
      value: resourceCapacity("corridor_transit"),
      unit: "count",
      editable: true,
    },
    {
      id: "cap_staging",
      label: "cap_staging.max_entities",
      group: "capacity",
      value: constraintParam("cap_staging", "max_entities"),
      unit: "slots",
      editable: true,
    },
    {
      id: "coolingCapacityKw",
      label: "coolingCapacityKw",
      group: "thermal",
      value: constraintParam("thermal_pool_u1", "max_heat_kw") || constraintParam("thermal_pool_u2", "max_heat_kw"),
      unit: "kW",
      editable: true,
    },
    {
      id: "transferDecayHeatLimitW",
      label: "transferDecayHeatLimitW",
      group: "thermal",
      value: constraintParam("thermal_lts", "max_heat_kw"),
      unit: "kW",
      editable: true,
    },
  ];
}

export function updateUnitRefuelingWindow(
  scenario: Record<string, unknown>,
  unitId: string,
  field: "from" | "to",
  value: number,
): Record<string, unknown> {
  const next = structuredClone(scenario);
  const unitModes = [...((next.unit_modes as UnitModeRecord[] | undefined) ?? [])];
  const index = unitModes.findIndex((mode) => mode.unit === unitId);
  if (index < 0) return next;
  const windows = [...(unitModes[index].windows ?? [{ from: 0, to: next.horizon_min, mode: "refueling" }])];
  windows[0] = { ...windows[0], [field]: value };
  unitModes[index] = { ...unitModes[index], windows };
  next.unit_modes = unitModes;

  if (field === "to") {
    const constraints = [...((next.constraints as ConstraintRecord[] | undefined) ?? [])];
    const horizonIdx = constraints.findIndex((entry) => entry.id === "temporal_horizon");
    if (horizonIdx >= 0) {
      constraints[horizonIdx] = {
        ...constraints[horizonIdx],
        params: { ...constraints[horizonIdx].params, latest_min: value },
      };
      next.constraints = constraints;
    }
  }
  return next;
}

export function updateEntityHeatKw(
  scenario: Record<string, unknown>,
  entityId: string,
  heatKw: number,
): Record<string, unknown> {
  const next = structuredClone(scenario);
  const entities = [...((next.entities as EntityRecord[] | undefined) ?? [])];
  const index = entities.findIndex((entity) => entity.id === entityId);
  if (index < 0) return next;
  entities[index] = {
    ...entities[index],
    state: { ...(entities[index].state ?? {}), heat_kw: heatKw },
  };
  next.entities = entities;

  const physics = (next.physics as {
    decay_models?: Array<{ entity_id: string; table: Array<{ time_min: number; heat_kw: number }> }>;
  }) ?? { decay_models: [] };
  const decayModels = [...(physics.decay_models ?? [])];
  const decayIndex = decayModels.findIndex((model) => model.entity_id === entityId);
  if (decayIndex >= 0) {
    const table = decayModels[decayIndex].table.map((point) => ({ ...point, heat_kw: heatKw }));
    decayModels[decayIndex] = { ...decayModels[decayIndex], table };
    next.physics = { ...physics, decay_models: decayModels };
  }
  return next;
}

export function updateEntityScheduleStart(
  schedule: Record<string, unknown>,
  entityId: string,
  startMin: number,
): Record<string, unknown> {
  const next = structuredClone(schedule);
  const moves = [...((next.moves as ScheduleMove[] | undefined) ?? [])];
  const entityStarts = moves
    .map((move, index) => ({ move, index }))
    .filter((entry) => entry.move.entity === entityId);
  if (entityStarts.length === 0) return next;

  const currentMin = Math.min(...entityStarts.map((entry) => Number(entry.move.start ?? 0)));
  const delta = startMin - currentMin;
  for (const entry of entityStarts) {
    moves[entry.index] = {
      ...moves[entry.index],
      start: Number(moves[entry.index].start ?? 0) + delta,
    };
  }
  next.moves = moves;
  return next;
}

export function updateEntityHomeUnit(
  scenario: Record<string, unknown>,
  schedule: Record<string, unknown> | null,
  entityId: string,
  unitId: string,
): ScenarioMutationResult {
  const unitIds = collectUnitIds(scenario);
  if (!unitIds.includes(unitId)) {
    return { ok: false, error: `Unknown unit "${unitId}".` };
  }

  if (entityHasConflictingUnitMoves(schedule, entityId, unitId, unitIds)) {
    return {
      ok: false,
      error: `Cannot assign ${entityId} to ${unitId}: schedule has unit-specific moves on another unit. Remove or edit those moves first.`,
    };
  }

  const next = structuredClone(scenario);
  const entities = [...((next.entities as EntityRecord[] | undefined) ?? [])];
  const index = entities.findIndex((entity) => entity.id === entityId);
  if (index < 0) {
    return { ok: false, error: `Entity "${entityId}" not found.` };
  }
  entities[index] = { ...entities[index], home_unit: unitId };
  next.entities = entities;
  return { ok: true, scenario: next };
}

export function updateGlobalParameter(
  scenario: Record<string, unknown>,
  paramId: string,
  value: number,
): Record<string, unknown> {
  const next = structuredClone(scenario);

  if (paramId === "horizon_min") {
    next.horizon_min = value;
    const constraints = [...((next.constraints as ConstraintRecord[] | undefined) ?? [])];
    const horizonIdx = constraints.findIndex((entry) => entry.id === "temporal_horizon");
    if (horizonIdx >= 0) {
      constraints[horizonIdx] = {
        ...constraints[horizonIdx],
        params: { ...constraints[horizonIdx].params, latest_min: value },
      };
      next.constraints = constraints;
    }
    const unitModes = [...((next.unit_modes as UnitModeRecord[] | undefined) ?? [])].map((mode) => ({
      ...mode,
      windows: (mode.windows ?? []).map((window) => ({ ...window, to: value })),
    }));
    next.unit_modes = unitModes;
    return next;
  }

  const edges = [...((next.topology as { edges?: TopologyEdge[] })?.edges ?? [])];
  const patchEdge = (edgeId: string) => {
    const index = edges.findIndex((edge) => edge.id === edgeId);
    if (index < 0) return;
    edges[index] = {
      ...edges[index],
      duration_min: { base_min: value, modifiers: edges[index].duration_min?.modifiers ?? [] },
    };
  };

  if (paramId === "corridorTransitMin") patchEdge("fresh_to_staging");
  if (paramId === "fhmCycleMin") {
    for (const edge of edges) {
      if (edge.id.startsWith("staging_to_core_")) patchEdge(edge.id);
    }
  }
  if (paramId === "coolingDwellMin") {
    for (const edge of edges) {
      if (edge.id.includes("_to_lts")) patchEdge(edge.id);
    }
  }
  next.topology = { ...(next.topology as object), edges };

  const constraints = [...((next.constraints as ConstraintRecord[] | undefined) ?? [])];
  const patchConstraint = (id: string, key: string) => {
    const index = constraints.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    constraints[index] = {
      ...constraints[index],
      params: { ...constraints[index].params, [key]: value },
    };
  };

  if (paramId === "required_cooling_min") patchConstraint("regulatory_cooling", "required_cooling_min");
  if (paramId === "cap_staging") patchConstraint("cap_staging", "max_entities");
  if (paramId === "coolingCapacityKw") {
    for (const constraint of constraints) {
      if (constraint.id.startsWith("thermal_pool_")) {
        patchConstraint(constraint.id, "max_heat_kw");
      }
    }
  }
  if (paramId === "transferDecayHeatLimitW") patchConstraint("thermal_lts", "max_heat_kw");
  next.constraints = constraints;

  if (paramId === "corridorCapacity") {
    const resources = [...((next.resources as ResourceRecord[] | undefined) ?? [])];
    const index = resources.findIndex((resource) => resource.type === "corridor_transit");
    if (index >= 0) resources[index] = { ...resources[index], capacity: value };
    next.resources = resources;
  }

  return next;
}

export function applyGlobalParameter(
  scenario: Record<string, unknown>,
  paramId: string,
  value: number,
): ScenarioMutationResult {
  if (paramId === "fhmCount") {
    return setFhmCount(scenario, value);
  }
  return { ok: true, scenario: updateGlobalParameter(scenario, paramId, value) };
}
