import type { RunResult, MatrixLockCapabilities, StructureLockMode } from "../../api";
import { ArtifactBrowser } from "../ArtifactBrowser";
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
  structureMode: StructureLockMode;
  onStructureModeChange: (mode: StructureLockMode) => void;
  lockCapabilities: MatrixLockCapabilities | null;
  lockCapabilitiesLoading: boolean;
  tuningPolicyEnabled: boolean;
  onTuningPolicyEnabledChange: (enabled: boolean) => void;
  tunableParamOptions: Array<{
    key: string;
    entityId: string;
    constraintId: string;
    constraintType: string;
    paramName: string;
  }>;
  tunableParamAllowlist: Set<string>;
  onToggleTunableParam: (entityId: string, constraintId: string, paramName: string, allowed: boolean) => void;
  onSelectAllTunableParams: () => void;
  onClearAllTunableParams: () => void;
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
  structureMode,
  onStructureModeChange,
  lockCapabilities,
  lockCapabilitiesLoading,
  tuningPolicyEnabled,
  onTuningPolicyEnabledChange,
  tunableParamOptions,
  tunableParamAllowlist,
  onToggleTunableParam,
  onSelectAllTunableParams,
  onClearAllTunableParams,
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
  const postRunWarnings = optimizeResult?.lock_contract?.effective?.unlock_warnings ?? [];
  const allowedTunableCount = tunableParamAllowlist.size;
  const policyModeActive = tuningPolicyEnabled;

  return (
    <div className="view-layout optimize-layout">
      <section className="panel optimize-controls">
        <h2 id="optimize-heading">Optimization</h2>
        <p className="hint">Running optimization for scenario: {scenarioPath}</p>
        <p className="hint">
          Timing-first mode uses the saved seed schedule at <strong>{schedulePath || "—"}</strong>, preserves the
          move set, and optimizes start times.
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
              Save scenario and schedule before running optimization. The optimizer reads saved files at{" "}
              <strong>{scenarioPath}</strong> and <strong>{schedulePath}</strong>, not unsaved editor changes.
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
            disabled
          >
            <option value="greedy">Greedy (coming soon)</option>
            <option value="cp_sat">CP-SAT (default)</option>
            <option value="hybrid_dummy">Hybrid (coming soon)</option>
          </select>
        </label>
        <p className="hint">Algorithm choice is fixed in v1-alpha. The backend currently runs CP-SAT.</p>

        <fieldset className="lock-controls optimise-lock-controls">
          <legend>Optimization policy</legend>
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
              Scenario-level tuning {scenarioLocksPreviewOnly ? "(preview only — not applied in this run)" : "(active)"}
            </p>
            {scenarioLocksPreviewOnly ? (
              <p className="hint">
                Allowlisted paths: {(lockCapabilities?.allowlisted_scenario_paths ?? ["horizon_min"]).join(", ")}.
                Scenario-level tuning is not active in v1.
              </p>
            ) : null}
          </div>

          <div className="lock-matrix-section">
            <h3 className="lock-matrix-heading">Parameter allowlist</h3>
            <p className="hint">
              Choose exactly which <code>(entity, constraint, parameter)</code> tuples are tunable during
              optimization.
            </p>
            <label htmlFor="tuning-policy-enabled" className="lock-mode-checkbox-row">
              <input
                id="tuning-policy-enabled"
                type="checkbox"
                checked={policyModeActive}
                disabled={loading || lockCapabilitiesLoading}
                onChange={(event) => onTuningPolicyEnabledChange(event.target.checked)}
              />
              <span className="lock-mode-toggle-caption">
                {policyModeActive
                  ? "Parameter allowlist enabled"
                  : "Enable parameter allowlist"}
              </span>
            </label>
            {policyModeActive ? (
              <>
                <p className="hint" role="status">
                  Allowed tuples selected: <strong>{allowedTunableCount}</strong> /{" "}
                  <strong>{tunableParamOptions.length}</strong>
                </p>
                <div className="button-row tuning-policy-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onSelectAllTunableParams}
                    disabled={loading || lockCapabilitiesLoading || tunableParamOptions.length === 0}
                  >
                    Allow all
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onClearAllTunableParams}
                    disabled={loading || lockCapabilitiesLoading || tunableParamOptions.length === 0}
                  >
                    Hold all constant
                  </button>
                </div>
                {lockCapabilitiesLoading ? (
                  <p className="hint" role="status">
                    Loading tunable parameter tuples...
                  </p>
                ) : tunableParamOptions.length === 0 ? (
                  <p className="hint" role="status">
                    No tunable parameter tuples are available for the current scenario and schedule.
                  </p>
                ) : (
                  <div className="table-wrap tuning-policy-table-wrap">
                    <table className="tuning-policy-table">
                      <thead>
                        <tr>
                          <th scope="col">Entity</th>
                          <th scope="col">Constraint</th>
                          <th scope="col">Type</th>
                          <th scope="col">Parameter</th>
                          <th scope="col">Tunable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tunableParamOptions.map((option) => {
                          const checked = tunableParamAllowlist.has(option.key);
                          return (
                            <tr key={option.key}>
                              <td>{option.entityId}</td>
                              <td>
                                <code>{option.constraintId}</code>
                              </td>
                              <td>{option.constraintType}</td>
                              <td>
                                <code>{option.paramName}</code>
                              </td>
                              <td>
                                <label className="lock-matrix-cell-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={loading}
                                    aria-label={`${checked ? "Tunable" : "Constant"}: ${option.entityId} / ${option.constraintId} / ${option.paramName}`}
                                    onChange={(event) =>
                                      onToggleTunableParam(
                                        option.entityId,
                                        option.constraintId,
                                        option.paramName,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  <span className="lock-matrix-checkbox-text">
                                    {checked ? "Tunable" : "Constant"}
                                  </span>
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="hint" role="status">
                Allowlist is disabled. Backend default tunability applies.
              </p>
            )}
          </div>
        </fieldset>

        <p className="hint" role="status">
          Active tunability control: <strong>{policyModeActive ? "parameter allowlist" : "backend default tunability"}</strong>.
        </p>

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
        {optimizeResult?.tuning_policy && (
          <p className="hint" role="status">
            Tuning policy: <strong>{optimizeResult.tuning_policy.source ?? "unknown"}</strong> (
            {(optimizeResult.tuning_policy.allow_tunable_params ?? []).length} tuples)
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

      <section className="panel optimize-results optimize-results-stack">
        <FeasibilitySummary
          result={optimizeResult}
          emptyMessage="Run optimization to inspect feasibility and objective."
          compact
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
                ? " Open in Builder to review and save."
                : " Loaded in Builder schedule (unsaved until you save)."}
            </p>
            <div className="button-row">
              {!optimizationAppliedToBuilder ? (
                <button type="button" className="btn btn-primary" onClick={onApplyToBuilder} disabled={loading}>
                  Switch to Builder and review optimized schedule
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={onGoToBuilder} disabled={loading}>
                  Open in Builder
                </button>
              )}
            </div>
          </div>
        )}
        <section className="inspector-shell">
          <h2>Inspector</h2>
          <ResultsInspector result={optimizeResult} hideSummaryMetrics />
          <ArtifactBrowser result={optimizeResult} disabled={loading} />
        </section>
      </section>
    </div>
  );
}
