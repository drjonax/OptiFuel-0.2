import type { RunResult } from "../api";

type Props = {
  result: RunResult | null;
  emptyMessage?: string;
};

export function FeasibilitySummary({
  result,
  emptyMessage = "Run a simulation to check feasibility.",
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

  return (
    <section className="feasibility-summary" aria-label="Feasibility summary">
      <h2>Feasibility</h2>
      <p className={isFeasible ? "ok feasibility-status" : "error feasibility-status"}>
        <strong>{isFeasible ? "Feasible" : "Not feasible"}</strong>
        {result.reason ? ` — ${result.reason}` : ""}
      </p>
      <p>
        Outcome: <strong>{String(outcome)}</strong>
      </p>
      <p className={hardViolations.length ? "error" : "ok"}>
        Violations: {violations.length} ({hardViolations.length} hard)
      </p>
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
