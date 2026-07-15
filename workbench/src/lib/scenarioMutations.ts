/** Pure scenario mutators for Builder topology & fleet actions. */

export type ScenarioMutationResult =
  | { ok: true; scenario: Record<string, unknown> }
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
  position?: unknown;
  state: Record<string, unknown>;
  history?: unknown[];
};

const RESOURCE_TYPES = ["fhm", "crew", "corridor_transit", "cask"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

const DEFAULT_EDGE_DURATIONS = {
  staging_to_core: 60,
  core_to_pool: 90,
  pool_to_lts: 120,
} as const;

const DEFAULT_THERMAL_POOL_KW = 500;

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

function collectUnitIds(scenario: Record<string, unknown>): Set<string> {
  const units = new Set<string>();
  for (const node of getNodes(scenario)) {
    if (node.unit && node.unit !== "shared") {
      units.add(node.unit);
    }
  }
  const unitModes = (scenario.unit_modes as Array<{ unit?: string }> | undefined) ?? [];
  for (const mode of unitModes) {
    if (mode.unit) units.add(mode.unit);
  }
  for (const resource of getResources(scenario)) {
    for (const unit of resource.shared_by ?? []) {
      units.add(unit);
    }
  }
  return units;
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

export function addEfa(scenario: Record<string, unknown>): ScenarioMutationResult {
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
    position: null,
    state: {
      burnup_mwd_kgu: 0,
      discharge_time_min: null,
      heat_kw: 1,
    },
    history: [],
  });
  next.entities = entities;

  const physics = getPhysics(next);
  if (!physics.decay_models.some((model) => model.entity_id === entityId)) {
    physics.decay_models.push({
      entity_id: entityId,
      table: [
        { time_min: 0, heat_kw: 1 },
        { time_min: 5000, heat_kw: 12 },
      ],
    });
  }
  if (!physics.core_exit_states.some((state) => state.entity_id === entityId)) {
    const horizon = Number(next.horizon_min ?? 10080);
    physics.core_exit_states.push({
      entity_id: entityId,
      cycle: 1,
      burnup_mwd_kgu: 22,
      discharge_time_min: Math.round(horizon * 0.4),
    });
  }
  setPhysics(next, physics);

  return { ok: true, scenario: next };
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

  const stagingResources = resolveRequiredResources(resources, ["fhm", "crew", "corridor_transit"]);
  if (!stagingResources.ok) return stagingResources;

  const corePoolResources = resolveRequiredResources(resources, ["fhm", "crew", "cask"]);
  if (!corePoolResources.ok) return corePoolResources;

  const ltsNode = nodes.find((node) => node.id === "lts");
  let ltsResources: string[] | null = null;
  if (ltsNode) {
    const resolved = resolveRequiredResources(resources, ["fhm", "corridor_transit", "cask"]);
    if (!resolved.ok) return resolved;
    ltsResources = resolved.ids;
  }

  if (!hasNode(nodes, coreId)) {
    nodes.push(makeNode(coreId, "core", unitId));
  }
  if (!hasNode(nodes, poolId)) {
    nodes.push(makeNode(poolId, "interim_pool", unitId));
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

  const horizon = Number(next.horizon_min ?? 10080);
  const unitModes = getUnitModes(next);
  if (!unitModes.some((mode) => mode.unit === unitId)) {
    unitModes.push({
      unit: unitId,
      windows: [{ from: 0, to: horizon, mode: "refueling" }],
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

  return { ok: true, scenario: next };
}
