import type { RunResult } from "../api";
import { deriveFeasibilityVerdict } from "../lib/feasibilityVerdict";

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
  const stripClass = compact ? "verdict-strip verdict-strip--compact" : "verdict-strip";

  if (!result) {
    return (
      <section className={`feasibility-summary ${stripClass}`} aria-label="Feasibility summary">
        <h2>Feasibility</h2>
        <p className="empty">{emptyMessage}</p>
      </section>
    );
  }

  const violations = result.violations ?? [];
  const hardViolations = violations.filter((v) => v.hard);
  const { outcomeLabel, isFeasible } = deriveFeasibilityVerdict(result);
  const objectiveTotal = result.objective?.total ?? result.score_total;

  return (
    <section className={`feasibility-summary ${stripClass}`} aria-label="Feasibility summary">
      <h2>Feasibility</h2>
      <dl className="summary-grid">
        <div className="summary-item">
          <dt>Verdict</dt>
          <dd className={isFeasible ? "pass" : "fail"} aria-live="polite">
            {isFeasible ? "Feasible" : "Not feasible"}
          </dd>
        </div>
        <div className="summary-item">
          <dt>Outcome</dt>
          <dd>{outcomeLabel}</dd>
        </div>
        {result.infeasible_category ? (
          <div className="summary-item">
            <dt>Category</dt>
            <dd>{result.infeasible_category}</dd>
          </div>
        ) : null}
        <div className="summary-item">
          <dt>Violations</dt>
          <dd className={hardViolations.length ? "fail" : "pass"}>
            {violations.length} ({hardViolations.length} hard)
          </dd>
        </div>
        <div className="summary-item">
          <dt>Objective</dt>
          <dd>{objectiveTotal ?? "n/a"}</dd>
        </div>
      </dl>
      {result.reason ? (
        <p className="hint">
          Reason: <strong>{result.reason}</strong>
        </p>
      ) : null}
      {hardViolations.length > 0 && (
        <ul className="feasibility-violations">
          {hardViolations.slice(0, 5).map((v, index) => (
            <li key={`${v.constraint_id}-${index}`}>
              <span className="violation-hard" title={String(v.message)}>
                {String(v.message)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
