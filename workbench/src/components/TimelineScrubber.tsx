import type { TimelineEvent } from "../lib/playback";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";

type Props = {
  timeline: TimelineEvent[];
  scrubTime: number;
  onScrub: (value: number) => void;
  horizonMin: number;
  selectedEventIndex: number | null;
  onSelectEvent: (index: number) => void;
  disabled?: boolean;
};

export function TimelineScrubber({
  timeline,
  scrubTime,
  onScrub,
  horizonMin,
  selectedEventIndex,
  onSelectEvent,
  disabled,
}: Props) {
  const maxTime = Math.max(
    1,
    scrubTime,
    horizonMin,
    timeline.reduce((max, event) => Math.max(max, Number(event.t_min ?? 0)), 0),
  );

  const { playing, setPlaying, step } = useTimelinePlayback({
    scrubTime,
    maxTime,
    disabled,
    onScrub,
  });

  if (timeline.length === 0) {
    return (
      <section className="timeline" aria-label="Timeline playback">
        <h3>Timeline Playback</h3>
        <p className="empty">No timeline yet. Run simulate or optimize to inspect execution.</p>
      </section>
    );
  }

  return (
    <section className="timeline" aria-label="Timeline playback">
      <h3>Timeline Playback</h3>
      <div className="timeline-controls">
        <button type="button" aria-label="Step back 60 minutes" disabled={disabled} onClick={() => step(-60)}>
          -60
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause playback" : "Start playback"}
          disabled={disabled}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" aria-label="Step forward 60 minutes" disabled={disabled} onClick={() => step(60)}>
          +60
        </button>
      </div>
      <label htmlFor="timeline-scrubber">
        t = {scrubTime} min
        <input
          id="timeline-scrubber"
          type="range"
          min={0}
          max={maxTime}
          value={scrubTime}
          aria-valuemin={0}
          aria-valuemax={maxTime}
          aria-valuenow={scrubTime}
          aria-label="Timeline scrubber"
          disabled={disabled}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
      </label>
      <ol className="timeline-events" aria-label="Timeline events">
        {timeline.slice(0, 40).map((event, index) => {
          const seen = Number(event.t_min) <= scrubTime;
          const selected = selectedEventIndex === index;
          return (
            <li key={`${event.kind}-${index}`}>
              <button
                type="button"
                className={`timeline-event ${seen ? "seen" : ""} ${selected ? "selected" : ""}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  onSelectEvent(index);
                  onScrub(Number(event.t_min));
                }}
              >
                <span className="event-time">{String(event.t_min)} min</span>
                <span className="event-kind">{String(event.kind)}</span>
                {event.entity ? <span className="event-entity">{String(event.entity)}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
