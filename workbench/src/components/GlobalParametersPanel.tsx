import { useMemo, useState } from "react";
import { applyGlobalParameter, deriveGlobalParameters, type GlobalParameterRow } from "../lib/scenarioBaseline";

type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  onMutationError?: (message: string) => void;
  disabled?: boolean;
};

const GROUP_ORDER: GlobalParameterRow["group"][] = ["timing", "capacity", "thermal"];

export function GlobalParametersPanel({ data, onChange, onMutationError, disabled }: Props) {
  const rows = useMemo(() => (data ? deriveGlobalParameters(data) : []), [data]);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  if (!data) {
    return <p className="empty">No scenario loaded.</p>;
  }

  const commitValue = (row: GlobalParameterRow, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      onMutationError?.(`${row.label} must be a number.`);
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }

    const result = applyGlobalParameter(data, row.id, parsed);
    if (!result.ok) {
      onMutationError?.(result.error);
      setDraftValues((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      return;
    }

    onMutationError?.("");
    onChange(result.scenario);
    setDraftValues((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
  };

  return (
    <section className="builder-settings-section" aria-labelledby="global-parameters-heading">
      <h3 id="global-parameters-heading">Global parameters</h3>
      <p className="hint">Mapped from optimiser `eventClockParameterPreset()` into this schema.</p>

      {GROUP_ORDER.map((group) => {
        const groupRows = rows.filter((row) => row.group === group);
        if (groupRows.length === 0) return null;
        return (
          <details key={group} className="builder-param-group" open={group === "timing" || group === "capacity"}>
            <summary className="builder-param-group-summary">{group}</summary>
            <div className="table-wrap builder-table-scroll">
              <table className="builder-matrix-table" aria-label={`${group} global parameters`}>
                <thead>
                  <tr>
                    <th scope="col">Parameter</th>
                    <th scope="col">Value</th>
                    <th scope="col">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <tr key={row.id}>
                      <td className="param-id">
                        {row.label}
                        {row.id === "fhmCount" && (
                          <span className="hint param-inline-hint">
                            Shared pool; unit legs round-robin. `fresh_to_staging` uses primary FHM.
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="param-value-input"
                          value={draftValues[row.id] ?? String(row.value)}
                          min={row.id === "fhmCount" ? 1 : undefined}
                          step={row.id === "fhmCount" ? 1 : undefined}
                          aria-label={`${row.label} value`}
                          disabled={disabled || !row.editable}
                          onChange={(e) =>
                            setDraftValues((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            if (!row.editable) return;
                            commitValue(row, e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                        />
                      </td>
                      <td className="param-unit">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </section>
  );
}
