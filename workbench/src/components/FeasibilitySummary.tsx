import type { RunResult } from "../api";

type Props = {
  result: RunResult | null;
  emptyMessage?: string;
  compact?: boolean;
};

export function FeasibilitySummary({
  result,
  emptyMessage = "Run a simulation to check feasibility.",
  compact = false,
}: Props) {
  if (!result) {
    return (
      <section className="feasibility-summary" aria-label="Feasibility summary">
        <h2>Feasibility</h2>
        <p className="empty">{emptyMessage}</p>
      </section>
    );
  }

  const violations = result.violations ?? [];
  const hardViolations = violations.filter((v) => v.hard);
  const outcome = result.outcome ?? (result.manifest ? "completed" : "unknown");
  const isFeasible = hardViolations.length === 0 && outcome !== "infeasible_or_timeout";
  const objectiveTotal = result.objective?.total ?? result.score_total;

  const stripClass = compact ? "verdict-strip verdict-strip--compact" : "verdict-strip";

  return (
    <section className={`feasibility-summary ${stripClass}`} aria-label="Feasibility summary">
      <h2>Feasibility</h2>
      <div className="summary-grid">
        <div className="summary-item">
          <label>Verdict</label>
          <div className={`value ${isFeasible ? "pass" : "fail"}`}>
            {isFeasible ? "Feasible" : "Not feasible"}
          </div>
        </div>
        <div className="summary-item">
          <label>Outcome</label>
          <div className="value">{String(outcome)}</div>
        </div>
        <div className="summary-item">
          <label>Violations</label>
          <div className={`value ${hardViolations.length ? "fail" : "pass"}`}>
            {violations.length} ({hardViolations.length} hard)
          </div>
        </div>
        <div className="summary-item">
          <label>Objective</label>
          <div className="value">{objectiveTotal ?? "n/a"}</div>
        </div>
      </div>
      {result.reason && <p className="hint">{result.reason}</p>}
      {hardViolations.length > 0 && (
        <ul className="feasibility-violations">
          {hardViolations.slice(0, 5).map((v, index) => (
            <li key={`${v.constraint_id}-${index}`}>
              <span className="violation-hard">{String(v.message)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
