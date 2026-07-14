import { useState } from "react";

type Props = {
  disabled?: boolean;
  onFork: (stateAt: number, amendments: Record<string, unknown>, precedence?: string) => void;
};

export function ForkPanel({ disabled, onFork }: Props) {
  const [stateAt, setStateAt] = useState(0);
  const [newHorizon, setNewHorizon] = useState(12000);
  const [precedence, setPrecedence] = useState("");

  return (
    <div>
      <h2>Fork From History</h2>
      <label>
        Boundary time (min)
        <input
          type="number"
          value={stateAt}
          aria-label="Fork boundary time"
          disabled={disabled}
          onChange={(e) => setStateAt(Number(e.target.value))}
        />
      </label>
      <label>
        New horizon (min)
        <input
          type="number"
          value={newHorizon}
          aria-label="Fork new horizon"
          disabled={disabled}
          onChange={(e) => setNewHorizon(Number(e.target.value))}
        />
      </label>
      <label>
        Precedence metadata
        <input
          value={precedence}
          aria-label="Amendment precedence"
          disabled={disabled}
          onChange={(e) => setPrecedence(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onFork(
            stateAt,
            {
              new_id: `reference_plant_fork_${stateAt}`,
              horizon_min: newHorizon,
            },
            precedence || undefined,
          )
        }
      >
        Fork Scenario
      </button>
    </div>
  );
}
