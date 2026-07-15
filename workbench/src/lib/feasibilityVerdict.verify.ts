import assert from "node:assert/strict";

import type { RunResult } from "../api";
import { deriveFeasibilityVerdict } from "./feasibilityVerdict";

function run(label: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${label}`);
  } catch (error) {
    console.error(`fail ${label}`);
    throw error;
  }
}

const feasible: RunResult = {
  outcome: "feasible",
  manifest: { failed: false },
  violations: [],
};

const failedManifest: RunResult = {
  manifest: { failed: true },
  violations: [],
};

const hardViolationOnly: RunResult = {
  manifest: { failed: false },
  violations: [{ constraint_id: "cap", hard: true, message: "x", entity_ids: [] }],
};

const explicitInfeasible: RunResult = {
  outcome: "infeasible_or_timeout",
  reason: "infeasible",
  infeasible_category: "resource_capacity_exceeded",
  manifest: { failed: true },
  violations: [],
};

run("explicit feasible outcome", () => {
  const v = deriveFeasibilityVerdict(feasible);
  assert.equal(v.isFeasible, true);
  assert.equal(v.outcomeLabel, "feasible");
});

run("manifest.failed without outcome is not feasible", () => {
  const v = deriveFeasibilityVerdict(failedManifest);
  assert.equal(v.isFeasible, false);
  assert.equal(v.outcomeLabel, "infeasible_or_timeout");
});

run("hard violations without outcome are not feasible", () => {
  const v = deriveFeasibilityVerdict(hardViolationOnly);
  assert.equal(v.isFeasible, false);
  assert.equal(v.outcomeLabel, "infeasible_or_timeout");
});

run("explicit infeasible outcome", () => {
  const v = deriveFeasibilityVerdict(explicitInfeasible);
  assert.equal(v.isFeasible, false);
  assert.equal(v.outcomeLabel, "infeasible_or_timeout");
});

console.log("feasibilityVerdict.verify: all checks passed");
