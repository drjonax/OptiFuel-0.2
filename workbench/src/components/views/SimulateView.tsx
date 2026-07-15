import type { RunResult } from "../../api";
import { ArtifactBrowser } from "../ArtifactBrowser";
import { FeasibilitySummary } from "../FeasibilitySummary";
import { GanttView } from "../GanttView";
import { ResultsInspector } from "../ResultsInspector";
import { TimelineScrubber } from "../TimelineScrubber";
import { TopologyView } from "../TopologyView";
import type { ScheduleMismatch } from "../../lib/scenarioSchedule";
import type { ScheduleMove, TimelineEvent, TopologyEdge, TopologyNode } from "../../lib/playback";
import type { PlaybackState } from "../../lib/playback";

type Props = {
  runtimeMode: string;
  onRuntimeModeChange: (mode: string) => void;
  onRunSimulate: () => void;
  simulateResult: RunResult | null;
  scheduleMismatch: ScheduleMismatch;
  onGoToBuilder: () => void;
  loading: boolean;
  moves: ScheduleMove[];
  edges: TopologyEdge[];
  nodes: TopologyNode[];
  timeline: TimelineEvent[];
  playback: PlaybackState;
  scrubTime: number;
  selectedMoveIndex: number | null;
  selectedEventIndex: number | null;
  selectedEdgeId: string | null;
  horizonMin: number;
  onSelectMove: (index: number) => void;
  onScrub: (time: number) => void;
  onSelectEvent: (index: number | null) => void;
};

export function SimulateView({
  runtimeMode,
  onRuntimeModeChange,
  onRunSimulate,
  simulateResult,
  scheduleMismatch,
  onGoToBuilder,
  loading,
  moves,
  edges,
  nodes,
  timeline,
  playback,
  scrubTime,
  selectedMoveIndex,
  selectedEventIndex,
  selectedEdgeId,
  horizonMin,
  onSelectMove,
  onScrub,
  onSelectEvent,
}: Props) {
  const simulateBlocked = scheduleMismatch.kind === "incompatible";

  return (
    <div className="view-layout simulate-layout">
      <section className="panel simulate-controls">
        <h2 id="simulate-heading">Simulation</h2>
        {scheduleMismatch.kind === "incompatible" && (
          <div className="warning-banner" role="alert">
            <p>{scheduleMismatch.message}</p>
            <button type="button" className="btn btn-secondary" onClick={onGoToBuilder}>
              Fix in Builder
            </button>
          </div>
        )}
        <div className="simulate-toolbar">
          <label htmlFor="runtime-mode-selector">
            Runtime mode
            <select
              id="runtime-mode-selector"
              value={runtimeMode}
              onChange={(e) => onRuntimeModeChange(e.target.value)}
              aria-label="Runtime mode"
              disabled={loading}
            >
              <option value="fail_fast">fail_fast</option>
              <option value="continue_and_report">continue_and_report</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRunSimulate}
            disabled={loading || simulateBlocked}
            aria-describedby={simulateBlocked ? "simulate-block-reason" : undefined}
          >
            Run Simulation
          </button>
        </div>
        {simulateBlocked && (
          <p id="simulate-block-reason" className="hint">
            Simulation is disabled until schedule references valid scenario entities and edges.
          </p>
        )}
      </section>

      {simulateResult && <FeasibilitySummary result={simulateResult} compact />}

      <div className="simulate-viewer-shell">
        <section className="panel simulate-primary simulate-gantt-panel" aria-labelledby="simulate-heading">
          <GanttView
            moves={moves}
            edges={edges}
            scrubTime={scrubTime}
            selectedMoveIndex={selectedMoveIndex}
            activeMoveIndices={playback.activeMoveIndices}
            completedMoveIndices={playback.completedMoveIndices}
            onSelectMove={onSelectMove}
            disabled={loading}
          />
        </section>

        <section className="panel simulate-secondary simulate-topology-panel panel-linked">
          <TopologyView
            nodes={nodes}
            edges={edges}
            playback={playback}
            scrubTime={scrubTime}
            selectedEdgeId={selectedEdgeId}
            disabled={loading}
            hasRunData={timeline.length > 0}
          />
        </section>

        <section className="panel simulate-timeline-panel">
          <TimelineScrubber
            timeline={timeline}
            scrubTime={scrubTime}
            onScrub={onScrub}
            horizonMin={horizonMin}
            selectedEventIndex={selectedEventIndex}
            onSelectEvent={onSelectEvent}
            disabled={loading}
          />
        </section>
      </div>

      <section className="inspector-shell simulate-results">
        <h2>Inspector</h2>
        <ResultsInspector result={simulateResult} hideSummaryMetrics />
        <ArtifactBrowser result={simulateResult} disabled={loading} />
      </section>
    </div>
  );
}
