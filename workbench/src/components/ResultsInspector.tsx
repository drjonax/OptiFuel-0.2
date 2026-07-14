import type { RunResult } from "../api";

type Props = {
  result: RunResult | null;
};

export function ResultsInspector({ result }: Props) {
  if (!result) {
    return <p className="empty">Run simulator or optimizer to inspect results.</p>;
  }

  const objectiveTotal = result.objective?.total ?? result.score_total;
  const violations = result.violations ?? [];
  const hardViolations = violations.filter((v) => v.hard);

  return (
    <div>
      <h2>Results</h2>
      <p>
        Outcome: <strong>{result.outcome ?? (result.manifest ? "completed" : "unknown")}</strong>
        {result.reason ? ` (${result.reason})` : ""}
      </p>
      <p>Objective total: {objectiveTotal ?? "n/a"}</p>
      <p className={hardViolations.length ? "error" : "ok"}>
        Violations: {violations.length} ({hardViolations.length} hard)
      </p>
      <ul>
        {violations.slice(0, 10).map((v, index) => (
          <li key={`${v.constraint_id}-${index}`}>
            <span className={v.hard ? "violation-hard" : "violation-soft"}>
              [{v.hard ? "HARD" : "soft"}] {String(v.message)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
