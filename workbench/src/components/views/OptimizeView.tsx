import type { RunResult } from "../../api";
import { ArtifactBrowser } from "../ArtifactBrowser";
import { FeasibilitySummary } from "../FeasibilitySummary";
import { OptimizationDeltaSummary } from "../OptimizationDeltaSummary";
import { ResultsInspector } from "../ResultsInspector";
import type { OptimizationDelta } from "../../lib/optimizationDiff";
import type { ScheduleMismatch } from "../../lib/scenarioSchedule";

export type OptimizationAlgorithm = "greedy" | "cp_sat" | "hybrid_dummy";

type Props = {
  scenarioPath: string;
  schedulePath: string;
  optimizationAlgorithm: OptimizationAlgorithm;
  onAlgorithmChange: (algorithm: OptimizationAlgorithm) => void;
  onRunOptimize: () => void;
  optimizeResult: RunResult | null;
  optimizedMoveCount: number | null;
  optimizationDelta: OptimizationDelta | null;
  hasPendingOptimization: boolean;
  optimizationAppliedToBuilder: boolean;
  onApplyToBuilder: () => void;
  scheduleMismatch: ScheduleMismatch;
  isScenarioDirty: boolean;
  isScheduleDirty: boolean;
  onGoToBuilder: () => void;
  loading: boolean;
};

export function OptimizeView({
  scenarioPath,
  schedulePath,
  optimizationAlgorithm,
  onAlgorithmChange,
  onRunOptimize,
  optimizeResult,
  optimizedMoveCount,
  optimizationDelta,
  hasPendingOptimization,
  optimizationAppliedToBuilder,
  onApplyToBuilder,
  scheduleMismatch,
  isScenarioDirty,
  isScheduleDirty,
  onGoToBuilder,
  loading,
}: Props) {
  const optimizeBlockedIncompatible = scheduleMismatch.kind === "incompatible";
  const optimizeBlockedDirty = isScenarioDirty || isScheduleDirty;
  const optimizeBlocked = optimizeBlockedIncompatible || optimizeBlockedDirty;

  return (
    <div className="view-layout optimize-layout">
      <section className="panel optimize-controls">
        <h2 id="optimize-heading">Optimization</h2>
        <p className="hint">Optimizes schedule for scenario: {scenarioPath}</p>

        {optimizeBlockedIncompatible && (
          <div className="warning-banner" role="alert">
            <p>{scheduleMismatch.message}</p>
            <button type="button" className="btn btn-secondary" onClick={onGoToBuilder}>
              Fix in Builder
            </button>
          </div>
        )}

        {optimizeBlockedDirty && (
          <div className="warning-banner" role="alert">
            <p>
              Save scenario and schedule before optimizing. Optimization compares saved files at{" "}
              <strong>{scenarioPath}</strong> and <strong>{schedulePath}</strong>, not unsaved editor state.
            </p>
            <button type="button" className="btn btn-secondary" onClick={onGoToBuilder}>
              Save in Builder
            </button>
          </div>
        )}

        <label htmlFor="optimization-algorithm">
          Algorithm
          <select
            id="optimization-algorithm"
            value={optimizationAlgorithm}
            onChange={(e) => onAlgorithmChange(e.target.value as OptimizationAlgorithm)}
            aria-label="Optimization algorithm"
            disabled={loading}
          >
            <option value="greedy">Greedy (dummy)</option>
            <option value="cp_sat">CP-SAT (dummy)</option>
            <option value="hybrid_dummy">Hybrid (dummy)</option>
          </select>
        </label>
        <p className="hint">Algorithm selection is UI-only in this release; backend uses the default optimizer.</p>

        <button
          type="button"
          className="btn btn-primary"
          onClick={onRunOptimize}
          disabled={loading || optimizeBlocked}
          aria-describedby={optimizeBlocked ? "optimize-block-reason" : undefined}
        >
          Run Optimization
        </button>
        {optimizeBlocked && (
          <p id="optimize-block-reason" className="hint">
            {optimizeBlockedDirty
              ? "Optimization is disabled until unsaved changes are saved."
              : "Optimization is disabled until schedule references valid scenario entities and edges."}
          </p>
        )}
      </section>

      <section className="panel optimize-results">
        <FeasibilitySummary
          result={optimizeResult}
          emptyMessage="Run optimization to inspect feasibility and objective."
        />
        <OptimizationDeltaSummary
          delta={optimizationDelta}
          optimizeOutcome={optimizeResult?.outcome}
          optimizeReason={optimizeResult?.reason}
        />
        {hasPendingOptimization && optimizedMoveCount !== null && (
          <div className="optimize-apply-row">
            <p className="optimize-schedule-preview">
              Optimized schedule ready: <strong>{optimizedMoveCount}</strong> moves.
              {!optimizationAppliedToBuilder
                ? " Load into Builder to edit and review."
                : " Loaded in Builder schedule (unsaved until you save)."}
            </p>
            <div className="button-row">
              {!optimizationAppliedToBuilder ? (
                <button type="button" className="btn btn-primary" onClick={onApplyToBuilder} disabled={loading}>
                  Load in Builder for review
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={onGoToBuilder} disabled={loading}>
                  Open in Builder
                </button>
              )}
            </div>
          </div>
        )}
        <ResultsInspector result={optimizeResult} />
        <ArtifactBrowser result={optimizeResult} disabled={loading} />
      </section>
    </div>
  );
}
