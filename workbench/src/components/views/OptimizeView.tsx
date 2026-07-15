import type { RunResult, MatrixLockCapabilities, StructureLockMode, LockEffectivePreview } from "../../api";
import { ArtifactBrowser } from "../ArtifactBrowser";
import { ConstraintLockMatrix } from "../ConstraintLockMatrix";
import { FeasibilitySummary } from "../FeasibilitySummary";
import { OptimizationDeltaSummary } from "../OptimizationDeltaSummary";
import { ResultsInspector } from "../ResultsInspector";
import { formatUnlockWarning } from "../../lib/constraintLockMatrix";
import type { OptimizationDelta } from "../../lib/optimizationDiff";
import type { ScheduleMismatch } from "../../lib/scenarioSchedule";

export type OptimizationAlgorithm = "greedy" | "cp_sat" | "hybrid_dummy";

type Props = {
  scenarioPath: string;
  schedulePath: string;
  optimizationAlgorithm: OptimizationAlgorithm;
  onAlgorithmChange: (algorithm: OptimizationAlgorithm) => void;
  lockModeEnabled: boolean;
  onLockModeEnabledChange: (enabled: boolean) => void;
  structureMode: StructureLockMode;
  onStructureModeChange: (mode: StructureLockMode) => void;
  lockCapabilities: MatrixLockCapabilities | null;
  lockCapabilitiesLoading: boolean;
  lockEffectivePreview: LockEffectivePreview | null;
  matrixLocks: Map<string, boolean>;
  onToggleMatrixLock: (entityId: string, constraintId: string, locked: boolean) => void;
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
  lockModeEnabled,
  onLockModeEnabledChange,
  structureMode,
  onStructureModeChange,
  lockCapabilities,
  lockCapabilitiesLoading,
  lockEffectivePreview,
  matrixLocks,
  onToggleMatrixLock,
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
  const lockBlockedNoSeed = !schedulePath;
  const scenarioLocksPreviewOnly = lockCapabilities?.scenario_tunable_active !== true;
  const pathsBlockedForMatrix = optimizeBlockedDirty;
  const postRunWarnings = optimizeResult?.lock_contract?.effective?.unlock_warnings ?? [];

  return (
    <div className="view-layout optimize-layout">
      <section className="panel optimize-controls">
        <h2 id="optimize-heading">Optimization</h2>
        <p className="hint">Optimizes schedule for scenario: {scenarioPath}</p>
        <p className="hint">
          Timing-first mode: uses saved seed schedule at <strong>{schedulePath || "—"}</strong>, preserves all
          moves, and optimizes start times. Constraint matrix controls parameter tunability only.
        </p>

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

        <fieldset className="lock-controls optimise-lock-controls">
          <legend>Optimise lock</legend>
          <label htmlFor="lock-mode-enabled" className="lock-mode-checkbox-row">
            <input
              id="lock-mode-enabled"
              type="checkbox"
              checked={lockModeEnabled}
              disabled={loading}
              onChange={(event) => onLockModeEnabledChange(event.target.checked)}
            />
            <span className="lock-mode-toggle-caption">
              Lock mode {lockModeEnabled ? "on" : "off"} — enables constraint parameter lock matrix
            </span>
          </label>

          {lockModeEnabled && (
            <>
              <label htmlFor="structure-mode">
                Structure mode
                <select
                  id="structure-mode"
                  value={structureMode}
                  onChange={(e) => onStructureModeChange(e.target.value as StructureLockMode)}
                  disabled={loading}
                  aria-label="Structure lock mode"
                >
                  <option value="locked">Locked (preserve move set from seed schedule)</option>
                  <option value="unlocked">Unlocked (timing-first still preserves move set in v1)</option>
                </select>
              </label>
              {structureMode === "locked" && (
                <p className="hint">
                  Uses saved schedule at <strong>{schedulePath}</strong> as structural baseline.
                </p>
              )}
              {lockBlockedNoSeed && (
                <p className="hint" role="alert">
                  Optimization requires a saved seed schedule path.
                </p>
              )}

              <div className="scenario-lock-preview" aria-live="polite">
                <p className="hint">
                  Scenario parameter locks{" "}
                  {scenarioLocksPreviewOnly ? "(preview — not applied in this run)" : "(active)"}
                </p>
                {scenarioLocksPreviewOnly ? (
                  <p className="hint">
                    Allowlisted paths: {(lockCapabilities?.allowlisted_scenario_paths ?? ["horizon_min"]).join(", ")}.
                    Backend scenario tuning is not active in v1.
                  </p>
                ) : null}
              </div>
            </>
          )}

          <div className="lock-matrix-section">
            <h3 className="lock-matrix-heading">Constraint lock matrix</h3>
            <p className="hint">
              Toggle each cell to lock or unlock parameter tuning. Unlocking any applicable row makes shared
              constraint params tunable globally.
            </p>
            {!lockModeEnabled && (
              <p className="hint" role="status">
                Enable lock mode to edit matrix checkboxes.
              </p>
            )}
            <ConstraintLockMatrix
              capabilities={lockCapabilities}
              matrixLocks={matrixLocks}
              effectivePreview={lockEffectivePreview}
              onToggleLock={onToggleMatrixLock}
              disabled={loading || !lockModeEnabled}
              loading={lockCapabilitiesLoading}
              pathsBlocked={pathsBlockedForMatrix}
            />
          </div>
        </fieldset>

        {optimizeResult?.execution_mode && (
          <p className="hint" role="status">
            Execution mode: <strong>{optimizeResult.execution_mode}</strong>
            {optimizeResult.resolved_seed_schedule_path ? (
              <>
                {" "}
                (seed: <strong>{optimizeResult.resolved_seed_schedule_path}</strong>)
              </>
            ) : null}
          </p>
        )}

        {optimizeResult?.lock_contract?.warning === "scenario_locks_not_applied" && (
          <p className="hint" role="status">
            Scenario locks were not applied in this run (preview-only capability).
          </p>
        )}

        {postRunWarnings.length > 0 && (
          <ul className="lock-matrix-warnings" role="status">
            {postRunWarnings.map((warning) => (
              <li key={warning}>{formatUnlockWarning(warning)}</li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={onRunOptimize}
          disabled={loading || optimizeBlocked || lockBlockedNoSeed}
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
