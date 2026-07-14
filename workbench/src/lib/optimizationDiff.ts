import type { RunResult, ScheduleMoveRecord, ViolationRecord } from "../api";

export type ViolationCounts = {
  total: number;
  hard: number;
};

export type ViolationDelta = {
  before: ViolationCounts;
  after: ViolationCounts;
  solved: ViolationRecord[];
  persisting: ViolationRecord[];
  newViolations: ViolationRecord[];
  solvedByConstraint: Array<{
    constraintId: string;
    ruleId: string;
    target: string;
    message: string;
    entityIds: string[];
    count: number;
  }>;
};

export type ScheduleChangeStats = {
  added: number;
  removed: number;
  retimed: number;
  rerouted: number;
  unchanged: number;
  changedEntities: string[];
};

export type OptimizationDelta = {
  violationDelta: ViolationDelta | null;
  scheduleChanges: ScheduleChangeStats | null;
  baselineAvailable: boolean;
};

function parseViolations(raw: Array<Record<string, unknown>> | undefined): ViolationRecord[] {
  return (raw ?? []).map((v) => ({
    constraint_id: String(v.constraint_id ?? ""),
    rule_id: v.rule_id != null ? String(v.rule_id) : undefined,
    target: v.target != null ? String(v.target) : undefined,
    scope: v.scope != null ? String(v.scope) : undefined,
    hard: Boolean(v.hard),
    message: String(v.message ?? ""),
    entity_ids: Array.isArray(v.entity_ids) ? v.entity_ids.map(String) : [],
    t_min: v.t_min != null ? Number(v.t_min) : null,
  }));
}

function violationSignature(v: ViolationRecord): string {
  const entities = [...v.entity_ids].sort().join(",");
  return `${v.constraint_id}|${v.target ?? ""}|${v.scope ?? ""}|${v.hard}|${entities}|${v.message}`;
}

function countViolations(violations: ViolationRecord[]): ViolationCounts {
  return {
    total: violations.length,
    hard: violations.filter((v) => v.hard).length,
  };
}

function multisetDiff(
  before: ViolationRecord[],
  after: ViolationRecord[],
): { solved: ViolationRecord[]; persisting: ViolationRecord[]; newViolations: ViolationRecord[] } {
  const beforeCounts = new Map<string, ViolationRecord[]>();
  const afterCounts = new Map<string, ViolationRecord[]>();

  for (const v of before) {
    const key = violationSignature(v);
    const list = beforeCounts.get(key) ?? [];
    list.push(v);
    beforeCounts.set(key, list);
  }
  for (const v of after) {
    const key = violationSignature(v);
    const list = afterCounts.get(key) ?? [];
    list.push(v);
    afterCounts.set(key, list);
  }

  const solved: ViolationRecord[] = [];
  const persisting: ViolationRecord[] = [];
  const newViolations: ViolationRecord[] = [];

  const allKeys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  for (const key of allKeys) {
    const bList = beforeCounts.get(key) ?? [];
    const aList = afterCounts.get(key) ?? [];
    const common = Math.min(bList.length, aList.length);
    for (let i = 0; i < common; i++) {
      persisting.push(bList[i]);
    }
    for (let i = common; i < bList.length; i++) {
      solved.push(bList[i]);
    }
    for (let i = common; i < aList.length; i++) {
      newViolations.push(aList[i]);
    }
  }

  return { solved, persisting, newViolations };
}

function groupSolvedByConstraint(solved: ViolationRecord[]): ViolationDelta["solvedByConstraint"] {
  const groups = new Map<
    string,
    { constraintId: string; ruleId: string; target: string; message: string; entityIds: Set<string>; count: number }
  >();

  for (const v of solved) {
    const key = v.constraint_id;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      for (const id of v.entity_ids) existing.entityIds.add(id);
    } else {
      groups.set(key, {
        constraintId: v.constraint_id,
        ruleId: v.rule_id ?? "",
        target: v.target ?? "",
        message: v.message,
        entityIds: new Set(v.entity_ids),
        count: 1,
      });
    }
  }

  return [...groups.values()].map((g) => ({
    constraintId: g.constraintId,
    ruleId: g.ruleId,
    target: g.target,
    message: g.message,
    entityIds: [...g.entityIds],
    count: g.count,
  }));
}

export function parseScheduleMoves(raw: Array<Record<string, unknown>> | undefined): ScheduleMoveRecord[] {
  return (raw ?? []).map((m) => ({
    entity: String(m.entity ?? ""),
    edge: String(m.edge ?? ""),
    start: Number(m.start ?? 0),
  }));
}

export function computeScheduleChanges(
  beforeMoves: ScheduleMoveRecord[],
  afterMoves: ScheduleMoveRecord[],
): ScheduleChangeStats {
  const beforeByEntity = new Map<string, ScheduleMoveRecord>();
  for (const m of beforeMoves) {
    beforeByEntity.set(m.entity, m);
  }
  const afterByEntity = new Map<string, ScheduleMoveRecord>();
  for (const m of afterMoves) {
    afterByEntity.set(m.entity, m);
  }

  let added = 0;
  let removed = 0;
  let retimed = 0;
  let rerouted = 0;
  let unchanged = 0;
  const changedEntities: string[] = [];

  for (const [entity, afterMove] of afterByEntity) {
    const beforeMove = beforeByEntity.get(entity);
    if (!beforeMove) {
      added += 1;
      changedEntities.push(entity);
      continue;
    }
    const edgeChanged = beforeMove.edge !== afterMove.edge;
    const startChanged = beforeMove.start !== afterMove.start;
    if (edgeChanged && startChanged) {
      rerouted += 1;
      retimed += 1;
      changedEntities.push(entity);
    } else if (edgeChanged) {
      rerouted += 1;
      changedEntities.push(entity);
    } else if (startChanged) {
      retimed += 1;
      changedEntities.push(entity);
    } else {
      unchanged += 1;
    }
  }

  for (const entity of beforeByEntity.keys()) {
    if (!afterByEntity.has(entity)) {
      removed += 1;
      changedEntities.push(entity);
    }
  }

  return { added, removed, retimed, rerouted, unchanged, changedEntities: [...new Set(changedEntities)] };
}

export function buildOptimizationDelta(
  baselineResult: RunResult | null,
  optimizeResult: RunResult | null,
  beforeMoves: ScheduleMoveRecord[],
  afterMoves: ScheduleMoveRecord[] | null,
): OptimizationDelta {
  if (!baselineResult) {
    return { violationDelta: null, scheduleChanges: null, baselineAvailable: false };
  }

  const beforeViolations = parseViolations(baselineResult.violations);
  const afterViolations = parseViolations(optimizeResult?.violations);
  const { solved, persisting, newViolations } = multisetDiff(beforeViolations, afterViolations);

  const violationDelta: ViolationDelta = {
    before: countViolations(beforeViolations),
    after: countViolations(afterViolations),
    solved,
    persisting,
    newViolations,
    solvedByConstraint: groupSolvedByConstraint(solved),
  };

  const scheduleChanges =
    afterMoves !== null ? computeScheduleChanges(beforeMoves, afterMoves) : null;

  return { violationDelta, scheduleChanges, baselineAvailable: true };
}

export function describeScheduleChanges(stats: ScheduleChangeStats): string {
  const parts: string[] = [];
  if (stats.retimed > 0) parts.push(`${stats.retimed} move(s) retimed`);
  if (stats.rerouted > 0) parts.push(`${stats.rerouted} move(s) rerouted`);
  if (stats.added > 0) parts.push(`${stats.added} move(s) added`);
  if (stats.removed > 0) parts.push(`${stats.removed} move(s) removed`);
  if (parts.length === 0) {
    return stats.unchanged > 0
      ? "Schedule structure unchanged; timing adjustments may still affect violations."
      : "No schedule move changes detected.";
  }
  return `Optimizer adjusted the schedule: ${parts.join(", ")}.`;
}
