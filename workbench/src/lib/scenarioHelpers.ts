/** Shared scenario topology helpers (no imports from baseline/mutations). */

export const DEFAULT_EFA_SEED_STEP_MIN = 30;
export const FRESH_TO_STAGING_EDGE = "fresh_to_staging";

type TopologyNode = { unit?: string };
type ResourceRecord = { id: string; type: string; shared_by?: string[] };
type ScheduleMove = { entity?: string; edge?: string; start?: number };

export function collectUnitIds(scenario: Record<string, unknown>): string[] {
  const units = new Set<string>();
  const topology = scenario.topology as { nodes?: TopologyNode[] } | undefined;
  for (const node of topology?.nodes ?? []) {
    if (node.unit && node.unit !== "shared") units.add(node.unit);
  }
  for (const mode of (scenario.unit_modes as Array<{ unit?: string }> | undefined) ?? []) {
    if (mode.unit) units.add(mode.unit);
  }
  for (const resource of (scenario.resources as ResourceRecord[] | undefined) ?? []) {
    for (const unit of resource.shared_by ?? []) {
      units.add(unit);
    }
  }
  return [...units].sort();
}

export function listFhmResourceIds(scenario: Record<string, unknown>): string[] {
  return (
    ((scenario.resources as ResourceRecord[] | undefined) ?? [])
      .filter((resource) => resource.type === "fhm")
      .map((resource) => resource.id)
      .sort()
  );
}

export function listNumericFhmIds(scenario: Record<string, unknown>): string[] {
  return listFhmResourceIds(scenario).filter((id) => /^fhm_(\d+)$/.test(id));
}

export function unitIndex(unitId: string, unitIds: string[]): number {
  return unitIds.indexOf(unitId);
}

export function pickFhmForUnit(unitId: string, fhmIds: string[], unitIds: string[]): string {
  if (fhmIds.length === 0) return "";
  const index = unitIndex(unitId, unitIds);
  if (index < 0) return fhmIds[0];
  return fhmIds[index % fhmIds.length];
}

/** Longest unit suffix match in edge id (avoids u1 matching u10). */
export function edgeUnitFromId(edgeId: string, unitIds: string[]): string | null {
  let best: string | null = null;
  let bestLen = 0;
  for (const unitId of unitIds) {
    const suffix = unitId.toLowerCase();
    const pattern = new RegExp(`_${suffix}(?:_|$)`);
    if (pattern.test(edgeId) && suffix.length > bestLen) {
      best = unitId;
      bestLen = suffix.length;
    }
  }
  return best;
}

export function isUnitSpecificEdge(edgeId: string, unitIds: string[]): boolean {
  return edgeUnitFromId(edgeId, unitIds) !== null;
}

export function replaceFhmInRequires(
  requires: string[],
  fhmIds: Set<string>,
  newFhmId: string,
): string[] {
  return requires.map((req) => (fhmIds.has(req) ? newFhmId : req));
}

export function nextFreshToStagingStart(
  schedule: Record<string, unknown> | null,
  scenario: Record<string, unknown>,
  homeUnit: string,
  stepMin = DEFAULT_EFA_SEED_STEP_MIN,
): number {
  const moves = (schedule?.moves as ScheduleMove[] | undefined) ?? [];
  const freshStarts = moves
    .filter((move) => move.edge === FRESH_TO_STAGING_EDGE)
    .map((move) => Number(move.start ?? 0));

  const unitModes = (scenario.unit_modes as Array<{ unit: string; windows?: Array<{ from?: number }> }>) ?? [];
  const mode = unitModes.find((entry) => entry.unit === homeUnit);
  const refuelingFrom = Number(mode?.windows?.[0]?.from ?? 0);

  let candidate = Math.max(refuelingFrom, 0);
  if (freshStarts.length === 0) return candidate;

  const occupied = new Set(freshStarts);
  while (occupied.has(candidate)) {
    candidate += stepMin;
  }
  return candidate;
}

export function countEntitiesPerUnit(scenario: Record<string, unknown>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unitId of collectUnitIds(scenario)) {
    counts.set(unitId, 0);
  }
  for (const entity of (scenario.entities as Array<{ home_unit?: string | null }> | undefined) ?? []) {
    if (entity.home_unit) {
      counts.set(entity.home_unit, (counts.get(entity.home_unit) ?? 0) + 1);
    }
  }
  return counts;
}

export function defaultHomeUnitForNewEfa(scenario: Record<string, unknown>): string | null {
  const unitIds = collectUnitIds(scenario);
  if (unitIds.length === 0) return null;
  const counts = countEntitiesPerUnit(scenario);
  let best = unitIds[0];
  let minCount = counts.get(best) ?? 0;
  for (const unitId of unitIds) {
    const count = counts.get(unitId) ?? 0;
    if (count < minCount) {
      best = unitId;
      minCount = count;
    }
  }
  return best;
}

export function entityHasConflictingUnitMoves(
  schedule: Record<string, unknown> | null,
  entityId: string,
  targetUnitId: string,
  unitIds: string[],
): boolean {
  const moves = (schedule?.moves as ScheduleMove[] | undefined) ?? [];
  for (const move of moves) {
    if (move.entity !== entityId || !move.edge) continue;
    if (move.edge === FRESH_TO_STAGING_EDGE) continue;
    const edgeUnit = edgeUnitFromId(move.edge, unitIds);
    if (edgeUnit && edgeUnit !== targetUnitId) return true;
  }
  return false;
}
