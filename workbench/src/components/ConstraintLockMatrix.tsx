import type { LockEffectivePreview, MatrixLockCapabilities } from "../api";
import { formatUnlockWarning, isCellLocked, matrixCellKey, matrixRowIds } from "../lib/constraintLockMatrix";

type Props = {
  capabilities: MatrixLockCapabilities | null;
  matrixLocks: Map<string, boolean>;
  effectivePreview: LockEffectivePreview | null;
  onToggleLock: (entityId: string, constraintId: string, locked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  pathsBlocked?: boolean;
};

function rowLabel(entityId: string, globalEntityId: string): string {
  return entityId === globalEntityId ? "Global" : entityId;
}

export function ConstraintLockMatrix({
  capabilities,
  matrixLocks,
  effectivePreview,
  onToggleLock,
  disabled = false,
  loading = false,
  pathsBlocked = false,
}: Props) {
  if (loading && !capabilities) {
    return <p className="hint">Loading lock matrix capabilities…</p>;
  }

  if (!capabilities?.constraints.length) {
    return <p className="hint">No scenario constraints available for lock matrix.</p>;
  }

  const globalId = capabilities.global_entity_id ?? "__global__";
  const rows = matrixRowIds(capabilities);
  const sharedUnlocked = new Set(effectivePreview?.shared_unlocked_constraint_ids ?? []);
  const lockedOnly = new Set(capabilities.locked_only_constraint_ids ?? []);
  const controlsDisabled = disabled || loading;

  return (
    <div className="constraint-lock-matrix">
      {pathsBlocked && (
        <p className="hint" role="status">
          Using last saved capabilities while files are dirty; save to refresh applicability.
        </p>
      )}
      <div className="lock-matrix-legend" aria-hidden="true">
        <span className="lock-matrix-legend-item">
          <span className="lock-matrix-legend-swatch lock-matrix-legend-swatch-locked" />
          Locked — optimizer keeps baseline params
        </span>
        <span className="lock-matrix-legend-item">
          <span className="lock-matrix-legend-swatch lock-matrix-legend-swatch-unlocked" />
          Unlocked — optimizer may tune params
        </span>
      </div>

      {effectivePreview?.unlock_warnings?.length ? (
        <ul className="lock-matrix-warnings" aria-live="polite">
          {effectivePreview.unlock_warnings.map((warning) => (
            <li key={warning}>{formatUnlockWarning(warning)}</li>
          ))}
        </ul>
      ) : null}

      <div className="table-wrap lock-matrix-scroll">
        <table aria-label="EFA by constraint lock matrix">
          <thead>
            <tr>
              <th scope="col" className="lock-matrix-sticky-col lock-matrix-sticky-header">
                Entity
              </th>
              {capabilities.constraints.map((constraint) => {
                const isSharedUnlocked = sharedUnlocked.has(constraint.id);
                return (
                  <th
                    key={constraint.id}
                    scope="col"
                    className={`lock-matrix-col-header${isSharedUnlocked ? " lock-matrix-col-unlocked" : ""}`}
                  >
                    <span className="lock-matrix-constraint-id">{constraint.id}</span>
                    <span className="lock-matrix-constraint-type">{constraint.type}</span>
                    {isSharedUnlocked ? (
                      <span className="badge lock-matrix-shared-badge" title="Unlocked globally (shared params)">
                        Tunable
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((entityId) => {
              const isGlobalRow = entityId === globalId;
              return (
                <tr key={entityId} className={isGlobalRow ? "lock-matrix-row-global" : undefined}>
                  <th scope="row" className="lock-matrix-sticky-col">
                    {rowLabel(entityId, globalId)}
                  </th>
                  {capabilities.constraints.map((constraint) => {
                    const applicable = capabilities.applicability[entityId]?.[constraint.id] ?? false;
                    const isLockedOnly = lockedOnly.has(constraint.id);
                    const locked = isCellLocked(matrixLocks, entityId, constraint.id);
                    const inputId = `lock-matrix-${matrixCellKey(entityId, constraint.id)}`;
                    const isShared = (capabilities.shared_constraint_ids ?? []).includes(constraint.id);
                    const isEffectivelyUnlocked = sharedUnlocked.has(constraint.id);
                    const showSharedHint =
                      isShared &&
                      !locked &&
                      entityId !== globalId &&
                      isEffectivelyUnlocked;

                    if (!applicable) {
                      return (
                        <td key={constraint.id} className="lock-matrix-na">
                          <span className="visually-hidden">Not applicable</span>
                          <span className="lock-matrix-na-mark" aria-hidden="true">
                            —
                          </span>
                        </td>
                      );
                    }

                    if (isLockedOnly) {
                      return (
                        <td key={constraint.id} className="lock-matrix-locked-only">
                          <span className="lock-matrix-status-pill lock-matrix-status-pill-fixed" title="Precedence constraints cannot be tuned in v1">
                            Fixed
                          </span>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={constraint.id}
                        className={`lock-matrix-cell${locked ? " lock-matrix-cell-locked" : " lock-matrix-cell-unlocked"}${isEffectivelyUnlocked ? " lock-matrix-cell-effective-unlock" : ""}`}
                      >
                        <label htmlFor={inputId} className="lock-matrix-cell-checkbox">
                          <input
                            id={inputId}
                            type="checkbox"
                            checked={locked}
                            disabled={controlsDisabled}
                            aria-label={`Lock tuning for ${rowLabel(entityId, globalId)} / ${constraint.id}`}
                            onChange={(event) => onToggleLock(entityId, constraint.id, event.target.checked)}
                          />
                          <span className="lock-matrix-checkbox-text">Lock</span>
                        </label>
                        {showSharedHint ? (
                          <p className="hint lock-matrix-shared-hint" role="note">
                            Shared unlock
                          </p>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
