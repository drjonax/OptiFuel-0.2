import { useMemo } from "react";
import { collectUnitIds } from "../lib/scenarioHelpers";
import {
  deriveStartingConditions,
  updateEntityHeatKw,
  updateEntityHomeUnit,
  updateEntityScheduleStart,
  updateUnitRefuelingWindow,
} from "../lib/scenarioBaseline";

type Props = {
  scenarioData: Record<string, unknown> | null;
  scheduleData: Record<string, unknown> | null;
  onScenarioChange: (data: Record<string, unknown>) => void;
  onScheduleChange: (data: Record<string, unknown>) => void;
  onMutationError?: (message: string) => void;
  disabled?: boolean;
};

export function StartingConditionsPanel({
  scenarioData,
  scheduleData,
  onScenarioChange,
  onScheduleChange,
  onMutationError,
  disabled,
}: Props) {
  const unitIds = useMemo(
    () => (scenarioData ? collectUnitIds(scenarioData) : []),
    [scenarioData],
  );

  const rows = useMemo(
    () => (scenarioData ? deriveStartingConditions(scenarioData, scheduleData) : []),
    [scenarioData, scheduleData],
  );

  if (!scenarioData) {
    return <p className="empty">No scenario loaded.</p>;
  }

  const unitCount = new Set(rows.map((row) => row.unitId).filter((id) => id !== "—")).size;
  const efaCount = rows.length;

  return (
    <section className="builder-settings-section" aria-labelledby="starting-conditions-heading">
      <h3 id="starting-conditions-heading">Starting conditions</h3>
      <p className="hint">
        Event-clock baseline with explicit `home_unit` per EFA. Refueling window is per unit; schedule start is per
        entity.
      </p>
      <div className="builder-site-summary" aria-live="polite">
        <span>
          {unitCount} unit{unitCount !== 1 ? "s" : ""}
        </span>
        <span>
          {efaCount} EFA{efaCount !== 1 ? "s" : ""}
        </span>
        <span>Sync: event_clock</span>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No units or EFAs in this scenario.</p>
      ) : (
        <div className="table-wrap builder-table-scroll">
          <table className="builder-matrix-table" aria-label="Starting conditions by unit and EFA">
            <thead>
              <tr>
                <th scope="col">Unit</th>
                <th scope="col">EFA</th>
                <th scope="col">Refueling from (min)</th>
                <th scope="col">Refueling to (min)</th>
                <th scope="col">Schedule start (min)</th>
                <th scope="col">Heat (kW)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.unitId}-${row.entityId}`}>
                  <td>
                    {unitIds.length === 0 ? (
                      <span className="empty">No units</span>
                    ) : (
                      <select
                        className="builder-cell-select"
                        value={row.unitId === "—" ? "" : row.unitId}
                        aria-label={`${row.entityId} home unit`}
                        title={
                          row.homeUnitBlocked
                            ? "Blocked: schedule has unit-specific moves on another unit."
                            : undefined
                        }
                        disabled={disabled || row.homeUnitBlocked}
                        onChange={(e) => {
                          const nextUnit = e.target.value;
                          if (!nextUnit) return;
                          const result = updateEntityHomeUnit(
                            scenarioData,
                            scheduleData,
                            row.entityId,
                            nextUnit,
                          );
                          if (!result.ok) {
                            onMutationError?.(result.error);
                            return;
                          }
                          onMutationError?.("");
                          onScenarioChange(result.scenario);
                        }}
                      >
                        {row.unitId === "—" && (
                          <option value="" disabled>
                            Unassigned
                          </option>
                        )}
                        {unitIds.map((unitId) => (
                          <option key={unitId} value={unitId}>
                            {unitId}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>{row.entityId}</td>
                  <td>
                    <input
                      type="number"
                      className="builder-cell-input"
                      min={0}
                      value={row.refuelingFrom}
                      aria-label={`${row.unitId} refueling from`}
                      disabled={disabled || row.unitId === "—"}
                      onChange={(e) =>
                        onScenarioChange(
                          updateUnitRefuelingWindow(scenarioData, row.unitId, "from", Number(e.target.value)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="builder-cell-input"
                      min={0}
                      value={row.refuelingTo}
                      aria-label={`${row.unitId} refueling to`}
                      disabled={disabled || row.unitId === "—"}
                      onChange={(e) =>
                        onScenarioChange(
                          updateUnitRefuelingWindow(scenarioData, row.unitId, "to", Number(e.target.value)),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="builder-cell-input"
                      min={0}
                      value={row.scheduleStartMin}
                      aria-label={`${row.entityId} schedule start`}
                      disabled={disabled || !scheduleData}
                      onChange={(e) => {
                        if (!scheduleData) return;
                        onScheduleChange(
                          updateEntityScheduleStart(scheduleData, row.entityId, Number(e.target.value)),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="builder-cell-input"
                      min={0}
                      step={0.1}
                      value={row.heatKw}
                      aria-label={`${row.entityId} heat`}
                      disabled={disabled}
                      onChange={(e) =>
                        onScenarioChange(
                          updateEntityHeatKw(scenarioData, row.entityId, Number(e.target.value)),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
