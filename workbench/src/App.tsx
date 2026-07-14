import { useEffect, useMemo, useState } from "react";
import {
  forkScenario,
  getScenario,
  getSchedule,
  listScenarios,
  optimize,
  saveScenario,
  saveSchedule,
  simulate,
  type RunResult,
} from "./api";
import { ArtifactBrowser } from "./components/ArtifactBrowser";
import { ForkPanel } from "./components/ForkPanel";
import { GanttView } from "./components/GanttView";
import { ResultsInspector } from "./components/ResultsInspector";
import { ScheduleEditor } from "./components/ScheduleEditor";
import { ScenarioParamsPanel } from "./components/ScenarioParamsPanel";
import { TimelineScrubber } from "./components/TimelineScrubber";
import { TopologyView } from "./components/TopologyView";
import {
  buildInitialLocations,
  derivePlaybackState,
  type ScheduleMove,
  type TimelineEvent,
  type TopologyEdge,
  type TopologyNode,
} from "./lib/playback";

const DEFAULT_SCENARIO = "examples/reference_plant/scenario.yaml";
const DEFAULT_SCHEDULE = "examples/reference_plant/schedule.yaml";

function asTimeline(events: Array<Record<string, unknown>>): TimelineEvent[] {
  return events.map((event) => ({
    t_min: Number(event.t_min ?? 0),
    entity: event.entity ? String(event.entity) : null,
    kind: String(event.kind ?? "unknown"),
    edge: event.edge ? String(event.edge) : null,
    detail: (event.detail as Record<string, unknown>) ?? {},
  }));
}

export default function App() {
  const [scenarioPath, setScenarioPath] = useState(DEFAULT_SCENARIO);
  const [schedulePath] = useState(DEFAULT_SCHEDULE);
  const [scenarioData, setScenarioData] = useState<Record<string, unknown> | null>(null);
  const [scheduleData, setScheduleData] = useState<Record<string, unknown> | null>(null);
  const [scenarioEtag, setScenarioEtag] = useState<string | undefined>();
  const [scheduleEtag, setScheduleEtag] = useState<string | undefined>();
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [runtimeMode, setRuntimeMode] = useState("fail_fast");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [scrubTime, setScrubTime] = useState(0);
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [scenarioList, scenario, schedule] = await Promise.all([
        listScenarios(),
        getScenario(scenarioPath),
        getSchedule(schedulePath),
      ]);
      setScenarios(scenarioList);
      setScenarioData(scenario.data);
      setScenarioEtag(scenario.etag);
      setScheduleData(schedule.data);
      setScheduleEtag(schedule.etag);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [scenarioPath, schedulePath]);

  const topology = (scenarioData?.topology as { nodes?: TopologyNode[]; edges?: TopologyEdge[] }) ?? {};
  const nodes = topology.nodes ?? [];
  const edges = (topology.edges ?? []).map((edge) => ({
    id: String(edge.id),
    from: String((edge as { from?: string; from_node?: string }).from ?? (edge as { from_node?: string }).from_node ?? ""),
    to: String((edge as { to?: string; to_node?: string }).to ?? (edge as { to_node?: string }).to_node ?? ""),
    duration_min: edge.duration_min,
  }));

  const scheduleMoves: ScheduleMove[] = useMemo(() => {
    const raw = (scheduleData?.moves as Array<{ entity?: string; edge?: string; start?: number }>) ?? [];
    return raw.map((move, index) => ({
      entity: String(move.entity ?? ""),
      edge: String(move.edge ?? ""),
      start: Number(move.start ?? 0),
      index,
    }));
  }, [scheduleData]);

  const timeline = useMemo(() => asTimeline(runResult?.timeline ?? []), [runResult]);

  const initialLocations = useMemo(
    () =>
      buildInitialLocations(
        ((scenarioData?.entities as Array<{ id: string; location: string }>) ?? []).map((entity) => ({
          id: entity.id,
          location: entity.location,
        })),
      ),
    [scenarioData],
  );

  const playback = useMemo(
    () => derivePlaybackState(scrubTime, timeline, scheduleMoves, edges, initialLocations),
    [scrubTime, timeline, scheduleMoves, edges, initialLocations],
  );

  const selectedEdgeId =
    selectedMoveIndex !== null ? (scheduleMoves[selectedMoveIndex]?.edge ?? null) : null;

  const selectMove = (index: number) => {
    setSelectedMoveIndex(index);
    const move = scheduleMoves[index];
    if (move) {
      setScrubTime(move.start);
    }
  };

  const saveScenarioData = async () => {
    if (!scenarioData) return;
    setLoading(true);
    setError(null);
    try {
      const saved = await saveScenario(scenarioPath, scenarioData, scenarioEtag);
      setScenarioEtag(saved.etag);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scenario");
    } finally {
      setLoading(false);
    }
  };

  const saveScheduleData = async () => {
    if (!scheduleData) return;
    setLoading(true);
    setError(null);
    try {
      const saved = await saveSchedule(schedulePath, scheduleData, scheduleEtag);
      setScheduleEtag(saved.etag);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setLoading(false);
    }
  };

  const runSim = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await simulate(scenarioPath, schedulePath, runtimeMode);
      setRunResult(result);
      setScrubTime(0);
      setSelectedMoveIndex(null);
      setSelectedEventIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  };

  const runOpt = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await optimize(scenarioPath);
      if (result.outcome === "feasible" && result.artifacts) {
        setRunResult(result.artifacts);
        if (result.schedule) {
          setScheduleData((prev) => ({ ...(prev ?? {}), moves: result.schedule?.moves ?? [] }));
        }
      } else {
        setRunResult(result);
      }
      setScrubTime(0);
      setSelectedMoveIndex(null);
      setSelectedEventIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFork = async (stateAt: number, amendments: Record<string, unknown>, precedence?: string) => {
    setLoading(true);
    setError(null);
    try {
      const forked = await forkScenario({
        scenario_path: scenarioPath,
        schedule_path: schedulePath,
        state_at_min: stateAt,
        amendments,
        precedence,
      });
      setScenarioPath(forked.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fork failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <h1>OptiFuel Workbench</h1>
          <p>Adjust, run, inspect, and replan with linked topology and schedule views.</p>
        </div>
        <span className="badge">v1-alpha</span>
        <div className="toolbar">
          <label htmlFor="scenario-selector">
            Scenario
            <select
              id="scenario-selector"
              value={scenarioPath}
              onChange={(e) => setScenarioPath(e.target.value)}
              aria-label="Scenario selector"
              disabled={loading}
            >
              {[DEFAULT_SCENARIO, ...scenarios.filter((s) => s !== DEFAULT_SCENARIO)].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="runtime-mode-selector">
            Runtime mode
            <select
              id="runtime-mode-selector"
              value={runtimeMode}
              onChange={(e) => setRuntimeMode(e.target.value)}
              aria-label="Runtime mode"
              disabled={loading}
            >
              <option value="fail_fast">fail_fast</option>
              <option value="continue_and_report">continue_and_report</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void runSim()} disabled={loading}>
            Simulate
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void runOpt()} disabled={loading}>
            Optimize
          </button>
        </div>
      </header>

      <div className="status-stack" aria-live="polite">
        {loading && (
          <p className="status" role="status">
            Loading scenario and schedule data...
          </p>
        )}
        {!loading && !error && (!scenarioData || !scheduleData) && (
          <p className="empty" role="status">
            No scenario data is loaded yet. Select a scenario or reload the workbench.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <main className="grid">
        <section className="panel">
          <ScenarioParamsPanel
            data={scenarioData}
            onChange={setScenarioData}
            onSave={() => void saveScenarioData()}
            disabled={loading}
          />
        </section>

        <section className="panel panel-linked">
          <ScheduleEditor
            data={scheduleData}
            onChange={setScheduleData}
            onSave={() => void saveScheduleData()}
            selectedMoveIndex={selectedMoveIndex}
            onSelectMove={selectMove}
            activeMoveIndices={playback.activeMoveIndices}
            disabled={loading}
          />
          <GanttView
            moves={scheduleMoves}
            edges={edges}
            scrubTime={scrubTime}
            selectedMoveIndex={selectedMoveIndex}
            activeMoveIndices={playback.activeMoveIndices}
            completedMoveIndices={playback.completedMoveIndices}
            onSelectMove={selectMove}
            disabled={loading}
          />
        </section>

        <section className="panel panel-linked">
          <TopologyView
            nodes={nodes}
            edges={edges}
            playback={playback}
            scrubTime={scrubTime}
            selectedEdgeId={selectedEdgeId}
            disabled={loading}
            hasRunData={timeline.length > 0}
          />
          <TimelineScrubber
            timeline={timeline}
            scrubTime={scrubTime}
            onScrub={setScrubTime}
            horizonMin={Number(scenarioData?.horizon_min ?? 0)}
            selectedEventIndex={selectedEventIndex}
            onSelectEvent={setSelectedEventIndex}
            disabled={loading}
          />
        </section>

        <section className="panel">
          <ForkPanel
            disabled={loading}
            onFork={(stateAt, amendments, precedence) => void handleFork(stateAt, amendments, precedence)}
          />
          <ResultsInspector result={runResult} />
          <ArtifactBrowser result={runResult} disabled={loading} />
        </section>
      </main>
    </div>
  );
}
