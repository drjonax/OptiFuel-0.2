/**
 * Lightweight runtime checks for optimization delta infeasible behavior.
 * Run with: npx tsx workbench/src/lib/optimizationDiff.verify.ts
 */
import {
  buildOptimizationDelta,
  computeScheduleChanges,
} from "./optimizationDiff";
import type { RunResult, ScheduleMoveRecord } from "../api";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const baselineViolations = [
  {
    constraint_id: "cap_staging",
    hard: true,
    message: "Node corridor_staging exceeds capacity 2",
    entity_ids: ["A1", "A2", "A3"],
  },
];

const baseline: RunResult = {
  outcome: "infeasible_or_timeout",
  violations: baselineViolations,
  timeline: [],
};

const infeasibleOptimize: RunResult = {
  outcome: "infeasible_or_timeout",
  reason: "infeasible",
};

const delta = buildOptimizationDelta(
  baseline,
  infeasibleOptimize,
  [],
  null,
  "infeasible_or_timeout",
);

assert(delta.violationDelta !== null, "expected violation delta");
assert(delta.violationDelta!.solved.length === 0, "infeasible must not mark solved violations");
assert(
  delta.violationDelta!.solvedByConstraint.length === 0,
  "infeasible must not populate solvedByConstraint",
);
assert(
  delta.violationDelta!.before.hard === delta.violationDelta!.after.hard,
  "infeasible after counts must mirror baseline",
);

const beforeMoves: ScheduleMoveRecord[] = [
  { entity: "A1", edge: "fresh_to_staging", start: 100 },
  { entity: "A1", edge: "staging_to_core_u1", start: 1500 },
];
const afterMoves: ScheduleMoveRecord[] = [
  { entity: "A1", edge: "fresh_to_staging", start: 200 },
  { entity: "A1", edge: "staging_to_core_u1", start: 1600 },
];
const changes = computeScheduleChanges(beforeMoves, afterMoves);
assert(changes.retimed === 2, "multi-move entity changes must count both retimed moves");
assert(changes.removed === 0 && changes.added === 0, "structure-preserving retime only");

console.log("optimizationDiff verification passed");
