type Move = { entity?: string; edge?: string; start?: number };

type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  onSave: () => void;
  selectedMoveIndex: number | null;
  onSelectMove: (index: number) => void;
  activeMoveIndices: Set<number>;
  disabled?: boolean;
};

export function ScheduleEditor({
  data,
  onChange,
  onSave,
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
    <div>
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
                      <input
                        data-move-index={String(index)}
                        data-edge={move.edge ?? ""}
                        aria-label={`Entity ${index}`}
                        value={move.entity ?? ""}
                        disabled={disabled}
                        onChange={(e) => updateMove(index, "entity", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Edge ${index}`}
                        value={move.edge ?? ""}
                        disabled={disabled}
                        onChange={(e) => updateMove(index, "edge", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Start ${index}`}
                        type="number"
                        value={move.start ?? 0}
                        disabled={disabled}
                        onChange={(e) => updateMove(index, "start", Number(e.target.value))}
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
      </div>
    </div>
  );
}
