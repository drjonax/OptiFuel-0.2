type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  disabled?: boolean;
};

export function ScenarioParamsPanel({ data, onChange, disabled }: Props) {
  if (!data) {
    return <p className="empty">No scenario loaded.</p>;
  }

  const horizon = Number(data.horizon_min ?? 0);

  return (
    <div className="scenario-params">
      <h3>Parameters</h3>
      <label>
        Horizon (min)
        <input
          type="number"
          value={horizon}
          aria-label="Horizon minutes"
          disabled={disabled}
          onChange={(e) => onChange({ ...data, horizon_min: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
