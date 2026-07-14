import { moveDuration, type ScheduleMove, type TopologyEdge } from "../lib/playback";

type Props = {
  moves: ScheduleMove[];
  edges: TopologyEdge[];
  scrubTime: number;
  selectedMoveIndex: number | null;
  activeMoveIndices: Set<number>;
  completedMoveIndices: Set<number>;
  onSelectMove: (index: number) => void;
  disabled?: boolean;
};

export function GanttView({
  moves,
  edges,
  scrubTime,
  selectedMoveIndex,
  activeMoveIndices,
  completedMoveIndices,
  onSelectMove,
  disabled,
}: Props) {
  const maxEnd = moves.reduce((max, move) => {
    const duration = moveDuration(move.edge, edges);
    return Math.max(max, move.start + duration);
  }, 100);

  if (moves.length === 0) {
    return (
      <section className="gantt" aria-label="Schedule Gantt">
        <h3>Gantt</h3>
        <p className="empty">No scheduled moves. Add moves in the table or run the optimizer.</p>
      </section>
    );
  }

  return (
    <section className="gantt" aria-label="Schedule Gantt">
      <h3>Gantt</h3>
      <ul role="list">
        {moves.map((move) => {
          const duration = moveDuration(move.edge, edges);
          const left = (move.start / maxEnd) * 100;
          const width = Math.max(4, (duration / maxEnd) * 100);
          const selected = selectedMoveIndex === move.index;
          const active = activeMoveIndices.has(move.index);
          const completed = completedMoveIndices.has(move.index);
          const stateLabel = completed ? "completed" : active ? "in progress" : scrubTime >= move.start ? "started" : "planned";

          return (
            <li key={`${move.entity}-${move.edge}-${move.index}`} className={selected ? "selected" : ""}>
              <button
                type="button"
                className="gantt-row"
                aria-pressed={selected}
                aria-label={`${move.entity} on ${move.edge} at ${move.start} minutes, ${stateLabel}`}
                disabled={disabled}
                onClick={() => onSelectMove(move.index)}
              >
                <span className="gantt-label">
                  {move.entity} → {move.edge}
                </span>
                <div className="bar-track" aria-hidden="true">
                  <div
                    className={`bar state-${stateLabel}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                  <div className="playhead" style={{ left: `${(scrubTime / maxEnd) * 100}%` }} />
                </div>
                <span className="gantt-meta">
                  {move.start}–{move.start + duration} min
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
