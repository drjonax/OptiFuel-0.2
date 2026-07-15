import { useMemo } from "react";
import { edgeUnitFromId } from "../lib/scenarioHelpers";

type Move = { entity?: string; edge?: string; start?: number };

type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  onSave: () => void;
  onRevert?: () => void;
  entityOptions?: string[];
  edgeOptions?: string[];
  edgesForEntity?: (entityId: string) => string[];
  entityHomeUnits?: Record<string, string | null | undefined>;
  unitIds?: string[];
  selectedMoveIndex: number | null;
  onSelectMove: (index: number) => void;
  activeMoveIndices: Set<number>;
  disabled?: boolean;
};

function SuggestInput({
  id,
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const listId = `${id}-options`;
  return (
    <>
      <input
        id={id}
        list={options.length > 0 ? listId : undefined}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}

function edgeCrossesHomeUnit(
  edgeId: string,
  homeUnit: string | null | undefined,
  unitIds: string[],
): boolean {
  if (!homeUnit || !edgeId) return false;
  const edgeUnit = edgeUnitFromId(edgeId, unitIds);
  return edgeUnit !== null && edgeUnit !== homeUnit;
}

export function ScheduleEditor({
  data,
  onChange,
  onSave,
  onRevert,
  entityOptions = [],
  edgeOptions = [],
  edgesForEntity,
  entityHomeUnits = {},
  unitIds = [],
  selectedMoveIndex,
  onSelectMove,
  activeMoveIndices,
  disabled,
}: Props) {
  if (!data) {
    return <p className="empty">No schedule loaded.</p>;
  }

  const moves = (data.moves as Move[]) ?? [];

  const updateMove = (index: number, field: keyof Move, value: string | number) => {
    const next = [...moves];
    next[index] = { ...next[index], [field]: value };
    onChange({ ...data, moves: next });
  };

  const addMove = () => {
    onChange({ ...data, moves: [...moves, { entity: "", edge: "", start: 0 }] });
  };

  const moveRow = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= moves.length) return;
    const next = [...moves];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange({ ...data, moves: next });
    if (selectedMoveIndex === index) {
      onSelectMove(targetIndex);
    } else if (selectedMoveIndex === targetIndex) {
      onSelectMove(index);
    }
  };

  const deleteRow = (index: number) => {
    const next = moves.filter((_, i) => i !== index);
    onChange({ ...data, moves: next });
    if (next.length === 0 || selectedMoveIndex === null) return;
    if (selectedMoveIndex === index) {
      onSelectMove(Math.min(index, next.length - 1));
    } else if (selectedMoveIndex > index) {
      onSelectMove(selectedMoveIndex - 1);
    }
  };

  const edgeOptionsForMove = (entityId: string): string[] => {
    if (!entityId || !edgesForEntity) return edgeOptions;
    return edgesForEntity(entityId);
  };

  return (
    <div className="schedule-editor">
      <h2>Schedule Editor</h2>
      <div className="table-wrap">
        <table aria-label="Schedule moves">
          <thead>
            <tr>
              <th scope="col">Entity</th>
              <th scope="col">Edge</th>
              <th scope="col">Start (min)</th>
              <th scope="col">State</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {moves.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No moves yet.
                </td>
              </tr>
            ) : (
              moves.map((move, index) => {
                const selected = selectedMoveIndex === index;
                const active = activeMoveIndices.has(index);
                const entityId = move.entity ?? "";
                const edgeWarning = edgeCrossesHomeUnit(
                  move.edge ?? "",
                  entityHomeUnits[entityId],
                  unitIds,
                );
                return (
                  <tr
                    key={`${move.entity}-${move.edge}-${index}`}
                    className={`${selected ? "selected" : ""} ${active ? "active" : ""}`}
                    onClick={() => onSelectMove(index)}
                  >
                    <td>
                      <SuggestInput
                        id={`move-entity-${index}`}
                        value={move.entity ?? ""}
                        options={entityOptions}
                        ariaLabel={`Entity ${index}`}
                        disabled={disabled}
                        onChange={(v) => updateMove(index, "entity", v)}
                      />
                    </td>
                    <td>
                      <SuggestInput
                        id={`move-edge-${index}`}
                        value={move.edge ?? ""}
                        options={edgeOptionsForMove(entityId)}
                        ariaLabel={`Edge ${index}`}
                        disabled={disabled}
                        onChange={(v) => updateMove(index, "edge", v)}
                      />
                      {edgeWarning && (
                        <p className="hint schedule-edge-warning" role="note">
                          Edge unit does not match {entityId} home unit ({entityHomeUnits[entityId]}). Allowed for
                          advanced edits.
                        </p>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Start ${index}`}
                        type="number"
                        value={move.start ?? 0}
                        disabled={disabled}
                        onChange={(e) => updateMove(index, "start", Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>
                      <span className={`move-state ${active ? "in-progress" : "planned"}`}>
                        {active ? "In progress" : "Planned"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          aria-label={`Move row ${index + 1} up`}
                          disabled={disabled || index === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveRow(index, "up");
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          aria-label={`Move row ${index + 1} down`}
                          disabled={disabled || index === moves.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            moveRow(index, "down");
                          }}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          aria-label={`Delete row ${index + 1}`}
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRow(index);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={addMove} disabled={disabled}>
          Add Move
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={disabled}>
          Save Schedule
        </button>
        {onRevert && (
          <button type="button" className="btn btn-secondary" onClick={onRevert} disabled={disabled}>
            Revert Schedule
          </button>
        )}
      </div>
    </div>
  );
}
