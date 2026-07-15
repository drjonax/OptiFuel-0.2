type StateLabels = {
  on: string;
  off: string;
};

type Props = {
  id: string;
  locked: boolean;
  disabled?: boolean;
  onChange: (locked: boolean) => void;
  label: string;
  compact?: boolean;
  caption?: string;
  stateLabels?: StateLabels;
};

const DEFAULT_STATE_LABELS: StateLabels = { on: "Locked", off: "Unlocked" };

export function LockToggle({
  id,
  locked,
  disabled = false,
  onChange,
  label,
  compact = false,
  caption,
  stateLabels = DEFAULT_STATE_LABELS,
}: Props) {
  return (
    <div className={`lock-toggle-wrap${compact ? " lock-toggle-wrap-compact" : ""}`}>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={locked}
        aria-label={label}
        disabled={disabled}
        className={`lock-toggle${locked ? " lock-toggle-locked" : " lock-toggle-unlocked"}`}
        onClick={() => onChange(!locked)}
      >
        <span className="lock-toggle-track" aria-hidden="true">
          <span className="lock-toggle-thumb" />
        </span>
        <span className="lock-toggle-label" aria-hidden="true">
          {locked ? stateLabels.on : stateLabels.off}
        </span>
      </button>
      {caption ? <span className="lock-toggle-caption">{caption}</span> : null}
      {!compact && !caption ? <span className="lock-toggle-caption">Lock tuning</span> : null}
    </div>
  );
}
