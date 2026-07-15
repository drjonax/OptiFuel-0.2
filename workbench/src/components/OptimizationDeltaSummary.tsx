import type { OptimizationDelta } from "../lib/optimizationDiff";
import { describeScheduleChanges } from "../lib/optimizationDiff";

type Props = {
  delta: OptimizationDelta | null;
  optimizeOutcome?: "feasible" | "infeasible_or_timeout" | null;
  optimizeReason?: "infeasible" | "timeout" | "structure_violation" | null;
};

export function OptimizationDeltaSummary({ delta, optimizeOutcome, optimizeReason }: Props) {
  if (!delta) {
    return (
      <section className="optimization-delta" aria-label="Optimization changes">
        <h2>Optimization Delta</h2>
        <p className="empty">Run optimization to compare violations and schedule changes.</p>
      </section>
    );
  }

  if (!delta.baselineAvailable) {
    return (
      <section className="optimization-delta" aria-label="Optimization changes">
        <h2>Optimization Delta</h2>
        <p className="hint">
          Baseline simulation was unavailable. Post-optimization results are shown below without a before/after
          comparison.
        </p>
      </section>
    );
  }

  if (optimizeOutcome === "infeasible_or_timeout") {
    return (
      <section className="optimization-delta" aria-label="Optimization changes">
        <h2>Optimization Delta</h2>
        <p className="hint">
          Optimization did not produce a feasible schedule
          {optimizeReason ? ` (${optimizeReason})` : ""}. Baseline violations are listed below for reference.
        </p>
        {delta.violationDelta && (
          <ViolationDeltaBlock violationDelta={delta.violationDelta} showAfterAsBaseline />
        )}
      </section>
    );
  }

  const { violationDelta, scheduleChanges } = delta;

  return (
    <section className="optimization-delta" aria-label="Optimization changes">
      <h2>Optimization Delta</h2>
      <p className="optimization-delta-scope">
        <strong>What changed:</strong> Scenario unchanged; schedule moves were adjusted by the optimizer.
      </p>

      {violationDelta && <ViolationDeltaBlock violationDelta={violationDelta} />}

      {scheduleChanges && (
        <div className="optimization-delta-section">
          <h3>How it was done</h3>
          <ul className="optimization-delta-stats">
            {scheduleChanges.retimed > 0 && (
              <li>
                <span className="delta-label">Retimed:</span> {scheduleChanges.retimed} move(s)
              </li>
            )}
            {scheduleChanges.rerouted > 0 && (
              <li>
                <span className="delta-label">Rerouted:</span> {scheduleChanges.rerouted} move(s)
              </li>
            )}
            {scheduleChanges.added > 0 && (
              <li>
                <span className="delta-label">Added:</span> {scheduleChanges.added} move(s)
              </li>
            )}
            {scheduleChanges.removed > 0 && (
              <li>
                <span className="delta-label">Removed:</span> {scheduleChanges.removed} move(s)
              </li>
            )}
            {scheduleChanges.unchanged > 0 && (
              <li>
                <span className="delta-label">Unchanged:</span> {scheduleChanges.unchanged} move(s)
              </li>
            )}
          </ul>
          <p className="hint">{describeScheduleChanges(scheduleChanges)}</p>
          {scheduleChanges.changedEntities.length > 0 && (
            <p className="hint">
              Affected entities: {scheduleChanges.changedEntities.slice(0, 8).join(", ")}
              {scheduleChanges.changedEntities.length > 8
                ? ` (+${scheduleChanges.changedEntities.length - 8} more)`
                : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ViolationDeltaBlock({
  violationDelta,
  showAfterAsBaseline = false,
}: {
  violationDelta: NonNullable<OptimizationDelta["violationDelta"]>;
  showAfterAsBaseline?: boolean;
}) {
  const solvedHard = violationDelta.solved.filter((v) => v.hard).length;
  const persistingHard = violationDelta.persisting.filter((v) => v.hard).length;
  const newHard = violationDelta.newViolations.filter((v) => v.hard).length;

  return (
    <>
      <div className="optimization-delta-section">
        <h3>Violation delta</h3>
        <p>
          Hard violations:{" "}
          <strong>
            {violationDelta.before.hard} → {showAfterAsBaseline ? violationDelta.before.hard : violationDelta.after.hard}
          </strong>
          {!showAfterAsBaseline && solvedHard > 0 && (
            <>
              {" "}
              (<span className="delta-solved-label">Likely solved: {solvedHard}</span>)
            </>
          )}
        </p>
        <p>
          Total violations:{" "}
          <strong>
            {violationDelta.before.total} → {showAfterAsBaseline ? violationDelta.before.total : violationDelta.after.total}
          </strong>
        </p>
        {!showAfterAsBaseline && (persistingHard > 0 || newHard > 0) && (
          <p className="hint">
            {persistingHard > 0 && (
              <span>
                <span className="delta-persist-label">Remaining hard:</span> {persistingHard}.{" "}
              </span>
            )}
            {newHard > 0 && (
              <span>
                <span className="delta-new-label">New hard:</span> {newHard}.
              </span>
            )}
          </p>
        )}
      </div>

      {violationDelta.solvedByConstraint.length > 0 && !showAfterAsBaseline && (
        <div className="optimization-delta-section">
          <h3>Solved constraints</h3>
          <ul className="optimization-delta-constraints">
            {violationDelta.solvedByConstraint.map((group) => (
              <li key={group.constraintId}>
                <span className="delta-solved-label">Solved</span>{" "}
                <strong>{group.constraintId}</strong>
                {group.target ? ` @ ${group.target}` : ""}
                {group.count > 1 ? ` (${group.count} occurrences)` : ""}
                <br />
                <span className="hint">{group.message}</span>
                {group.entityIds.length > 0 && (
                  <>
                    <br />
                    <span className="hint">
                      Entities: {group.entityIds.slice(0, 5).join(", ")}
                      {group.entityIds.length > 5 ? ` (+${group.entityIds.length - 5} more)` : ""}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!showAfterAsBaseline &&
        violationDelta.solved.length === 0 &&
        violationDelta.before.total === violationDelta.after.total &&
        violationDelta.before.total > 0 && (
          <p className="hint">Violations remain; optimizer did not resolve constraint conflicts in this run.</p>
        )}

      {!showAfterAsBaseline && violationDelta.before.total === 0 && violationDelta.after.total === 0 && (
        <p className="ok">No violations before or after optimization.</p>
      )}
    </>
  );
}
