/** Pure scenario mutators for Builder topology & fleet actions. */

import {
  collectUnitIds,
  edgeUnitFromId,
  FRESH_TO_STAGING_EDGE,
  listFhmResourceIds,
  listNumericFhmIds,
  nextFreshToStagingStart,
  pickFhmForUnit,
  replaceFhmInRequires,
} from "./scenarioHelpers";

export type ScenarioMutationResult =
  | { ok: true; scenario: Record<string, unknown> }
  | { ok: false; error: string };

export type ScheduleSeedMove = { entity: string; edge: string; start: number };

export type AddEfaResult =
  | { ok: true; scenario: Record<string, unknown>; scheduleSeed: ScheduleSeedMove }
  | { ok: false; error: string };

type TopologyNode = {
  id: string;
  type: string;
  unit?: string;
  boundary?: string;
  geometry?: unknown;
  attributes?: Record<string, unknown>;
};

type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  requires: string[];
  duration_min: { base_min: number; modifiers: unknown[] };
};

type ResourceRecord = {
  id: string;
  type: string;
  capacity?: number;
  calendar?: unknown[];
  shared_by?: string[];
  holds_entities?: boolean;
};

type EntityRecord = {
  id: string;
  location: string;
  home_unit?: string | null;
  position?: unknown;
  state: Record<string, unknown>;
  history?: unknown[];
};

const RESOURCE_TYPES = ["fhm", "crew", "corridor_transit", "cask"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

const DEFAULT_EDGE_DURATIONS = {
  staging_to_core: 45,
  core_to_pool: 90,
  pool_to_lts: 120,
} as const;

const DEFAULT_THERMAL_POOL_KW = 500;
const DEFAULT_HORIZON_MIN = 1440;
const DEFAULT_ENTITY_HEAT_KW = 1.5;
const DEFAULT_UNIT_STAGGER_MIN = 200;
const DEFAULT_SHORT_DISCHARGE_MIN = 1;

function cloneScenario(scenario: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(scenario)) as Record<string, unknown>;
}

function getNodes(scenario: Record<string, unknown>): TopologyNode[] {
  const topology = scenario.topology as { nodes?: TopologyNode[] } | undefined;
  return [...(topology?.nodes ?? [])];
}

function getEdges(scenario: Record<string, unknown>): TopologyEdge[] {
  const topology = scenario.topology as { edges?: TopologyEdge[] } | undefined;
  return [...(topology?.edges ?? [])];
}

function setTopology(
  scenario: Record<string, unknown>,
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): void {
  scenario.topology = { nodes, edges };
}

function getResources(scenario: Record<string, unknown>): ResourceRecord[] {
  return [...((scenario.resources as ResourceRecord[] | undefined) ?? [])];
}

function getEntities(scenario: Record<string, unknown>): EntityRecord[] {
  return [...((scenario.entities as EntityRecord[] | undefined) ?? [])];
}

function getArrivals(scenario: Record<string, unknown>): Array<{ entity_id?: string }> {
  return [...((scenario.arrivals as Array<{ entity_id?: string }> | undefined) ?? [])];
}

function getPhysics(scenario: Record<string, unknown>): {
  decay_models: Array<{ entity_id: string; table: Array<{ time_min: number; heat_kw: number }> }>;
  core_exit_states: Array<{
    entity_id: string;
    cycle: number;
    burnup_mwd_kgu: number;
    discharge_time_min: number;
  }>;
} {
  const physics = (scenario.physics as Record<string, unknown> | undefined) ?? {};
  return {
    decay_models: [
      ...((physics.decay_models as Array<{
        entity_id: string;
        table: Array<{ time_min: number; heat_kw: number }>;
      }>) ?? []),
    ],
    core_exit_states: [
      ...((physics.core_exit_states as Array<{
        entity_id: string;
        cycle: number;
        burnup_mwd_kgu: number;
        discharge_time_min: number;
      }>) ?? []),
    ],
  };
}

function setPhysics(
  scenario: Record<string, unknown>,
  physics: ReturnType<typeof getPhysics>,
): void {
  scenario.physics = physics;
}

function collectEntityIds(scenario: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const entity of getEntities(scenario)) {
    if (entity.id) ids.add(entity.id);
  }
  for (const arrival of getArrivals(scenario)) {
    if (arrival.entity_id) ids.add(arrival.entity_id);
  }
  const physics = getPhysics(scenario);
  for (const model of physics.decay_models) {
    if (model.entity_id) ids.add(model.entity_id);
  }
  for (const state of physics.core_exit_states) {
    if (state.entity_id) ids.add(state.entity_id);
  }
  return ids;
}

function allocateNextEntityId(scenario: Record<string, unknown>): string {
  const ids = collectEntityIds(scenario);
  let max = 0;
  for (const id of ids) {
    const match = /^A(\d+)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `A${max + 1}`;
}

function allocateNextUnitId(scenario: Record<string, unknown>): string {
  const units = collectUnitIds(scenario);
  let max = 0;
  for (const unit of units) {
    const match = /^U(\d+)$/.exec(unit);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `U${max + 1}`;
}

function findSourceNode(nodes: TopologyNode[]): TopologyNode | null {
  const source = nodes.find((node) => node.boundary === "source");
  if (source) return source;
  const freshStore = nodes.find((node) => node.type === "fresh_store");
  if (freshStore) return freshStore;
  return nodes[0] ?? null;
}

function resolveResourceByType(
  resources: ResourceRecord[],
  type: ResourceType,
): string | null {
  const matches = resources
    .filter((resource) => resource.type === type)
    .map((resource) => resource.id)
    .sort();
  return matches[0] ?? null;
}

function resolveRequiredResources(
  resources: ResourceRecord[],
  types: ResourceType[],
): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids: string[] = [];
  for (const type of types) {
    const id = resolveResourceByType(resources, type);
    if (!id) {
      return {
        ok: false,
        error: `Missing required resource type "${type}" in scenario resources.`,
      };
    }
    ids.push(id);
  }
  return { ok: true, ids };
}

function resolveUnitEdgeResources(
  resources: ResourceRecord[],
  unitId: string,
  unitIds: string[],
  types: ResourceType[],
): { ok: true; ids: string[] } | { ok: false; error: string } {
  const fhmIds = listFhmResourceIds({ resources } as Record<string, unknown>);
  const ids: string[] = [];
  for (const type of types) {
    if (type === "fhm") {
      const fhmId = pickFhmForUnit(unitId, fhmIds, unitIds);
      if (!fhmId) {
        return { ok: false, error: 'Missing required resource type "fhm" in scenario resources.' };
      }
      ids.push(fhmId);
      continue;
    }
    const id = resolveResourceByType(resources, type);
    if (!id) {
      return {
        ok: false,
        error: `Missing required resource type "${type}" in scenario resources.`,
      };
    }
    ids.push(id);
  }
  return { ok: true, ids };
}

function mergeSharedBy(resources: ResourceRecord[], unitId: string): ResourceRecord[] {
  return resources.map((resource) => {
    const sharedBy = [...(resource.shared_by ?? [])];
    if (!sharedBy.includes(unitId)) {
      sharedBy.push(unitId);
      sharedBy.sort();
    }
    return { ...resource, shared_by: sharedBy };
  });
}

function makeNode(id: string, type: string, unit: string): TopologyNode {
  return {
    id,
    type,
    unit,
    boundary: "none",
    geometry: null,
    attributes: {},
  };
}

function makeEdge(
  id: string,
  from: string,
  to: string,
  requires: string[],
  baseMin: number,
): TopologyEdge {
  return {
    id,
    from,
    to,
    requires,
    duration_min: { base_min: baseMin, modifiers: [] },
  };
}

function hasEdge(edges: TopologyEdge[], id: string): boolean {
  return edges.some((edge) => edge.id === id);
}

function hasNode(nodes: TopologyNode[], id: string): boolean {
  return nodes.some((node) => node.id === id);
}

function hasConstraint(
  constraints: Array<{ id?: string; target?: string }>,
  target: string,
): boolean {
  return constraints.some((constraint) => constraint.target === target);
}

function getUnitModes(scenario: Record<string, unknown>): Array<{
  unit: string;
  windows: Array<{ from: number; to: number; mode: string }>;
}> {
  return [
    ...((scenario.unit_modes as Array<{
      unit: string;
      windows: Array<{ from: number; to: number; mode: string }>;
    }> | undefined) ?? []),
  ];
}

function getConstraints(scenario: Record<string, unknown>): Array<{
  id: string;
  scope: string;
  target: string;
  type: string;
  predicate: Record<string, unknown>;
  hard: boolean;
  params: Record<string, unknown>;
}> {
  return [
    ...((scenario.constraints as Array<{
      id: string;
      scope: string;
      target: string;
      type: string;
      predicate: Record<string, unknown>;
      hard: boolean;
      params: Record<string, unknown>;
    }> | undefined) ?? []),
  ];
}

function fhmIdSet(scenario: Record<string, unknown>): Set<string> {
  return new Set(listFhmResourceIds(scenario));
}

function hasResourceFhmConstraint(constraints: ReturnType<typeof getConstraints>): boolean {
  return constraints.some((constraint) => constraint.id === "resource_fhm");
}

function maxNumericFhmSuffix(scenario: Record<string, unknown>): number {
  const numeric = listNumericFhmIds(scenario);
  let max = 0;
  for (const id of numeric) {
    const match = /^fhm_(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function makeFhmResource(id: string, sharedBy: string[]): ResourceRecord {
  return {
    id,
    type: "fhm",
    capacity: 1,
    calendar: [],
    shared_by: sharedBy,
    holds_entities: false,
  };
}

function makeFhmConstraint(resourceId: string, usePrimaryId: boolean): {
  id: string;
  scope: string;
  target: string;
  type: string;
  predicate: Record<string, unknown>;
  hard: boolean;
  params: Record<string, unknown>;
} {
  const match = /^fhm_(\d+)$/.exec(resourceId);
  const constraintId =
    usePrimaryId || !match ? "resource_fhm" : `resource_fhm_${match[1]}`;
  return {
    id: constraintId,
    scope: "resource",
    target: resourceId,
    type: "resource",
    predicate: {},
    hard: true,
    params: { max_concurrent: 1 },
  };
}

export function rewireFhmEdges(scenario: Record<string, unknown>): void {
  const fhmIds = listFhmResourceIds(scenario);
  if (fhmIds.length === 0) return;

  const fhmSet = new Set(fhmIds);
  const unitIds = collectUnitIds(scenario);
  const primaryFhm = fhmIds[0];
  const edges = getEdges(scenario);

  for (const edge of edges) {
    const usesFhm = edge.requires.some((req) => fhmSet.has(req));
    if (!usesFhm) continue;

    let targetFhm = primaryFhm;
    if (edge.id === FRESH_TO_STAGING_EDGE) {
      targetFhm = primaryFhm;
    } else {
      const edgeUnit = edgeUnitFromId(edge.id, unitIds);
      if (edgeUnit) {
        targetFhm = pickFhmForUnit(edgeUnit, fhmIds, unitIds);
      }
    }
    edge.requires = replaceFhmInRequires(edge.requires, fhmSet, targetFhm);
  }

  setTopology(scenario, getNodes(scenario), edges);
}

export function setFhmCount(
  scenario: Record<string, unknown>,
  targetCount: number,
): ScenarioMutationResult {
  if (!Number.isInteger(targetCount) || targetCount < 1) {
    return { ok: false, error: "fhmCount must be an integer >= 1." };
  }

  const currentCount = listFhmResourceIds(scenario).length;
  if (currentCount === targetCount) {
    return { ok: true, scenario: cloneScenario(scenario) };
  }

  const next = cloneScenario(scenario);
  let resources = getResources(next);
  let constraints = getConstraints(next);

  if (targetCount > currentCount) {
    while (listFhmResourceIds(next).length < targetCount) {
      const sharedBy = collectUnitIds(next);
      const nextSuffix = maxNumericFhmSuffix(next) + 1;
      const newId = `fhm_${nextSuffix}`;
      resources = [...getResources(next), makeFhmResource(newId, sharedBy)];
      next.resources = resources;

      const usePrimaryId = !hasResourceFhmConstraint(constraints);
      constraints = [...getConstraints(next), makeFhmConstraint(newId, usePrimaryId)];
      next.constraints = constraints;
    }
  } else {
    while (listFhmResourceIds(next).length > targetCount) {
      const numericIds = listNumericFhmIds(next).sort((a, b) => {
        const na = Number(/^fhm_(\d+)$/.exec(a)?.[1] ?? 0);
        const nb = Number(/^fhm_(\d+)$/.exec(b)?.[1] ?? 0);
        return nb - na;
      });

      if (numericIds.length === 0) {
        return {
          ok: false,
          error: `Cannot reduce fhmCount below ${listFhmResourceIds(next).length} while legacy FHM resources exist; remove manually in Code Viewer.`,
        };
      }

      const removeId = numericIds[0];
      const remaining = listFhmResourceIds(next).filter((id) => id !== removeId);
      const fallbackId = remaining[0];
      if (!fallbackId) {
        return { ok: false, error: "Cannot remove the last FHM resource." };
      }

      const edges = getEdges(next);
      const fhmSet = new Set([removeId]);
      for (const edge of edges) {
        if (edge.requires.includes(removeId)) {
          edge.requires = replaceFhmInRequires(edge.requires, fhmSet, fallbackId);
        }
      }
      setTopology(next, getNodes(next), edges);

      resources = getResources(next).filter((resource) => resource.id !== removeId);
      next.resources = resources;
      constraints = getConstraints(next).filter((constraint) => constraint.target !== removeId);
      next.constraints = constraints;
    }
  }

  const sharedBy = collectUnitIds(next);
  resources = getResources(next).map((resource) =>
    resource.type === "fhm" ? { ...resource, shared_by: [...sharedBy] } : resource,
  );
  next.resources = resources;

  rewireFhmEdges(next);
  return { ok: true, scenario: next };
}

export function addEfa(
  scenario: Record<string, unknown>,
  homeUnit: string,
  schedule: Record<string, unknown> | null = null,
): AddEfaResult {
  const unitIds = collectUnitIds(scenario);
  if (!unitIds.includes(homeUnit)) {
    return { ok: false, error: `Unknown home unit "${homeUnit}".` };
  }

  const next = cloneScenario(scenario);
  const entityId = allocateNextEntityId(next);
  const nodes = getNodes(next);
  const sourceNode = findSourceNode(nodes);
  if (!sourceNode) {
    return { ok: false, error: "No source node found to place new assembly." };
  }

  const entities = getEntities(next);
  entities.push({
    id: entityId,
    location: sourceNode.id,
    home_unit: homeUnit,
    position: null,
    state: {
      burnup_mwd_kgu: 0,
      discharge_time_min: null,
      heat_kw: DEFAULT_ENTITY_HEAT_KW,
    },
    history: [],
  });
  next.entities = entities;

  const physics = getPhysics(next);
  if (!physics.decay_models.some((model) => model.entity_id === entityId)) {
    physics.decay_models.push({
      entity_id: entityId,
      table: [
        { time_min: 0, heat_kw: DEFAULT_ENTITY_HEAT_KW },
        { time_min: 5000, heat_kw: DEFAULT_ENTITY_HEAT_KW },
      ],
    });
  }
  if (!physics.core_exit_states.some((state) => state.entity_id === entityId)) {
    const horizon = Number(next.horizon_min ?? DEFAULT_HORIZON_MIN);
    physics.core_exit_states.push({
      entity_id: entityId,
      cycle: 1,
      burnup_mwd_kgu: 22,
      discharge_time_min: Math.min(
        Math.round(horizon * 0.4),
        horizon - DEFAULT_SHORT_DISCHARGE_MIN,
      ),
    });
  }
  setPhysics(next, physics);

  const start = nextFreshToStagingStart(schedule, next, homeUnit);
  const scheduleSeed: ScheduleSeedMove = {
    entity: entityId,
    edge: FRESH_TO_STAGING_EDGE,
    start,
  };

  return { ok: true, scenario: next, scheduleSeed };
}

export function addUnitScaffold(scenario: Record<string, unknown>): ScenarioMutationResult {
  const next = cloneScenario(scenario);
  const unitId = allocateNextUnitId(next);
  const unitSuffix = unitId.toLowerCase();
  const coreId = `core_${unitSuffix}`;
  const poolId = `pool_${unitSuffix}`;

  const nodes = getNodes(next);
  const edges = getEdges(next);
  const resources = getResources(next);

  const stagingNode = nodes.find((node) => node.id === "corridor_staging");
  if (!stagingNode) {
    return {
      ok: false,
      error: 'Required node "corridor_staging" is missing from topology.',
    };
  }

  if (!hasNode(nodes, coreId)) {
    nodes.push(makeNode(coreId, "core", unitId));
  }
  if (!hasNode(nodes, poolId)) {
    nodes.push(makeNode(poolId, "interim_pool", unitId));
  }

  const unitIds = [...collectUnitIds(next), unitId].filter((v, i, a) => a.indexOf(v) === i).sort();

  const stagingResources = resolveUnitEdgeResources(
    resources,
    unitId,
    unitIds,
    ["fhm", "crew", "corridor_transit"],
  );
  if (!stagingResources.ok) return stagingResources;

  const corePoolResources = resolveUnitEdgeResources(resources, unitId, unitIds, [
    "fhm",
    "crew",
    "cask",
  ]);
  if (!corePoolResources.ok) return corePoolResources;

  const ltsNode = nodes.find((node) => node.id === "lts");
  let ltsResources: string[] | null = null;
  if (ltsNode) {
    const resolved = resolveUnitEdgeResources(resources, unitId, unitIds, [
      "fhm",
      "corridor_transit",
      "cask",
    ]);
    if (!resolved.ok) return resolved;
    ltsResources = resolved.ids;
  }

  const stagingEdgeId = `staging_to_${coreId}`;
  if (!hasEdge(edges, stagingEdgeId)) {
    edges.push(
      makeEdge(
        stagingEdgeId,
        stagingNode.id,
        coreId,
        stagingResources.ids,
        DEFAULT_EDGE_DURATIONS.staging_to_core,
      ),
    );
  }

  const corePoolEdgeId = `${coreId}_to_pool`;
  if (!hasEdge(edges, corePoolEdgeId)) {
    edges.push(
      makeEdge(
        corePoolEdgeId,
        coreId,
        poolId,
        corePoolResources.ids,
        DEFAULT_EDGE_DURATIONS.core_to_pool,
      ),
    );
  }

  if (ltsNode && ltsResources) {
    const poolLtsEdgeId = `${poolId}_to_lts`;
    if (!hasEdge(edges, poolLtsEdgeId)) {
      edges.push(
        makeEdge(
          poolLtsEdgeId,
          poolId,
          ltsNode.id,
          ltsResources,
          DEFAULT_EDGE_DURATIONS.pool_to_lts,
        ),
      );
    }
  }

  setTopology(next, nodes, edges);

  const horizon = Number(next.horizon_min ?? DEFAULT_HORIZON_MIN);
  const unitModes = getUnitModes(next);
  if (!unitModes.some((mode) => mode.unit === unitId)) {
    const unitMatch = /^U(\d+)$/.exec(unitId);
    const unitNumber = unitMatch ? Number(unitMatch[1]) : 1;
    const windowStart = unitNumber > 1 ? (unitNumber - 1) * DEFAULT_UNIT_STAGGER_MIN : 0;
    unitModes.push({
      unit: unitId,
      windows: [{ from: windowStart, to: horizon, mode: "refueling" }],
    });
    next.unit_modes = unitModes;
  }

  const constraints = getConstraints(next);
  const thermalId = `thermal_${poolId}`;
  if (!hasConstraint(constraints, poolId)) {
    constraints.push({
      id: thermalId,
      scope: "node",
      target: poolId,
      type: "thermal",
      predicate: {},
      hard: true,
      params: { max_heat_kw: DEFAULT_THERMAL_POOL_KW },
    });
    next.constraints = constraints;
  }

  next.resources = mergeSharedBy(resources, unitId);

  if (listFhmResourceIds(next).length > 1) {
    rewireFhmEdges(next);
  }

  return { ok: true, scenario: next };
}
