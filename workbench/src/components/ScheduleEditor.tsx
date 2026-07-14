type Move = { entity?: string; edge?: string; start?: number };

type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  onSave: () => void;
  onRevert?: () => void;
  entityOptions?: string[];
  edgeOptions?: string[];
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

export function ScheduleEditor({
  data,
  onChange,
  onSave,
  onRevert,
  entityOptions = [],
  edgeOptions = [],
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
            </tr>
          </thead>
          <tbody>
            {moves.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty">
                  No moves yet.
                </td>
              </tr>
            ) : (
              moves.map((move, index) => {
                const selected = selectedMoveIndex === index;
                const active = activeMoveIndices.has(index);
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
                        options={edgeOptions}
                        ariaLabel={`Edge ${index}`}
                        disabled={disabled}
                        onChange={(v) => updateMove(index, "edge", v)}
                      />
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
