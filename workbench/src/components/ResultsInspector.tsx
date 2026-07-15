import type { RunResult } from "../api";

type Props = {
  result: RunResult | null;
  hideSummaryMetrics?: boolean;
};

export function ResultsInspector({ result, hideSummaryMetrics = false }: Props) {
  if (!result) {
    return <p className="empty">Run simulator or optimizer to inspect results.</p>;
  }

  const violations = result.violations ?? [];
  const hardViolations = violations.filter((v) => v.hard);

  return (
    <div className="results-inspector">
      <h2>Results detail</h2>
      {!hideSummaryMetrics && result.reason && (
        <p>
          Reason: <strong>{result.reason}</strong>
        </p>
      )}
      <ul>
        {violations.slice(0, 10).map((v, index) => (
          <li key={`${v.constraint_id}-${index}`}>
            <span className={v.hard ? "violation-hard" : "violation-soft"}>
              [{v.hard ? "HARD" : "soft"}] {String(v.message)}
            </span>
          </li>
        ))}
      </ul>
      {violations.length === 0 && <p className="ok">No violations reported.</p>}
      {violations.length > 10 && (
        <p className="hint">Showing 10 of {violations.length} violations. See artifacts for full list.</p>
      )}
      {!hideSummaryMetrics && hardViolations.length === 0 && violations.length > 0 && (
        <p className="hint">Only soft violations remain.</p>
      )}
    </div>
  );
}
