type Props = {
  data: Record<string, unknown> | null;
  onChange: (data: Record<string, unknown>) => void;
  onSave: () => void;
  disabled?: boolean;
};

export function ScenarioParamsPanel({ data, onChange, onSave, disabled }: Props) {
  if (!data) {
    return <p className="empty">No scenario loaded.</p>;
  }

  const horizon = Number(data.horizon_min ?? 0);

  return (
    <div>
      <h2>Scenario Parameters</h2>
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
      <button type="button" onClick={onSave} disabled={disabled}>
        Save Scenario
      </button>
      <pre className="yaml-preview">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
