import type { RunResult } from "../api";

export type FeasibilityOutcomeLabel = "feasible" | "infeasible_or_timeout" | "unknown";

export type FeasibilityVerdict = {
  outcomeLabel: FeasibilityOutcomeLabel;
  isFeasible: boolean;
};

/** Derive user-facing outcome and verdict from simulation/optimization run payload. */
export function deriveFeasibilityVerdict(result: RunResult): FeasibilityVerdict {
  const violations = result.violations ?? [];
  const hardViolations = violations.filter((v) => v.hard);
  const manifestFailed = Boolean(result.manifest?.failed);

  if (result.outcome === "feasible") {
    return { outcomeLabel: "feasible", isFeasible: true };
  }
  if (result.outcome === "infeasible_or_timeout") {
    return { outcomeLabel: "infeasible_or_timeout", isFeasible: false };
  }

  if (manifestFailed || hardViolations.length > 0) {
    return { outcomeLabel: "infeasible_or_timeout", isFeasible: false };
  }

  if (result.manifest) {
    return { outcomeLabel: "feasible", isFeasible: true };
  }

  return { outcomeLabel: "unknown", isFeasible: false };
}
