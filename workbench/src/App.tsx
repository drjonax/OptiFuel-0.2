import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ViewTabs, viewPanelId, type WorkbenchView } from "./components/ViewTabs";
import { BuilderView } from "./components/views/BuilderView";
import { OptimizeView, type OptimizationAlgorithm } from "./components/views/OptimizeView";
import { SimulateView } from "./components/views/SimulateView";
import {
  buildInitialLocations,
  derivePlaybackState,
  type ScheduleMove,
  type TimelineEvent,
  type TopologyEdge,
  type TopologyNode,
} from "./lib/playback";
import {
  detectScheduleMismatch,
  extractEdgeIds,
  extractEntityIds,
  siblingSchedulePath,
} from "./lib/scenarioSchedule";
import {
  buildOptimizationDelta,
  parseScheduleMoves,
  type OptimizationDelta,
} from "./lib/optimizationDiff";

const DEFAULT_SCENARIO = "examples/reference_plant/scenario.yaml";

function asTimeline(events: Array<Record<string, unknown>>): TimelineEvent[] {
  return events.map((event) => ({
    t_min: Number(event.t_min ?? 0),
    entity: event.entity ? String(event.entity) : null,
    kind: String(event.kind ?? "unknown"),
    edge: event.edge ? String(event.edge) : null,
    detail: (event.detail as Record<string, unknown>) ?? {},
  }));
}

function snapshotData(data: Record<string, unknown> | null): string {
  return data ? JSON.stringify(data) : "";
}

function confirmIfDirty(isDirty: boolean, message: string): boolean {
  if (!isDirty) return true;
  return window.confirm(message);
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkbenchView>("builder");
  const [scenarioPath, setScenarioPath] = useState(DEFAULT_SCENARIO);
  const [schedulePath, setSchedulePath] = useState(() => siblingSchedulePath(DEFAULT_SCENARIO));
  const [scenarioData, setScenarioData] = useState<Record<string, unknown> | null>(null);
  const [scheduleData, setScheduleData] = useState<Record<string, unknown> | null>(null);
  const [savedScenarioSnapshot, setSavedScenarioSnapshot] = useState("");
  const [savedScheduleSnapshot, setSavedScheduleSnapshot] = useState("");
  const [scenarioEtag, setScenarioEtag] = useState<string | undefined>();
  const [scheduleEtag, setScheduleEtag] = useState<string | undefined>();
  const [siblingScheduleLoaded, setSiblingScheduleLoaded] = useState(true);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [runtimeMode, setRuntimeMode] = useState("fail_fast");
  const [optimizationAlgorithm, setOptimizationAlgorithm] = useState<OptimizationAlgorithm>("cp_sat");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulateResult, setSimulateResult] = useState<RunResult | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<RunResult | null>(null);
  const [optimizeBaselineResult, setOptimizeBaselineResult] = useState<RunResult | null>(null);
  const [preOptMoves, setPreOptMoves] = useState<Array<{ entity: string; edge: string; start: number }> | null>(
    null,
  );
  const [postOptMoves, setPostOptMoves] = useState<Array<{ entity: string; edge: string; start: number }> | null>(
    null,
  );
  const [optimizedMoveCount, setOptimizedMoveCount] = useState<number | null>(null);
  const [optimizationAppliedToBuilder, setOptimizationAppliedToBuilder] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);

  const isScenarioDirty = useMemo(
    () => scenarioData !== null && snapshotData(scenarioData) !== savedScenarioSnapshot,
    [scenarioData, savedScenarioSnapshot],
  );

  const isScheduleDirty = useMemo(
    () => scheduleData !== null && snapshotData(scheduleData) !== savedScheduleSnapshot,
    [scheduleData, savedScheduleSnapshot],
  );

  const isDirty = isScenarioDirty || isScheduleDirty;

  const scheduleMismatch = useMemo(
    () =>
      detectScheduleMismatch(
        scenarioData,
        scheduleData,
        siblingScheduleLoaded,
        siblingSchedulePath(scenarioPath),
      ),
    [scenarioData, scheduleData, siblingScheduleLoaded, scenarioPath],
  );

  const loadScenarioAndSchedule = useCallback(async (nextScenarioPath: string, keepScheduleOnFail = false) => {
    setLoading(true);
    setError(null);
    const siblingPath = siblingSchedulePath(nextScenarioPath);
    try {
      const [scenarioList, scenario] = await Promise.all([
        listScenarios(),
        getScenario(nextScenarioPath),
      ]);
      setScenarios(scenarioList.includes(nextScenarioPath) ? scenarioList : [...scenarioList, nextScenarioPath]);
      setScenarioPath(nextScenarioPath);
      setScenarioData(scenario.data);
      setSavedScenarioSnapshot(snapshotData(scenario.data));
      setScenarioEtag(scenario.etag);

      try {
        const schedule = await getSchedule(siblingPath);
        setSchedulePath(siblingPath);
        setScheduleData(schedule.data);
        setSavedScheduleSnapshot(snapshotData(schedule.data));
        setScheduleEtag(schedule.etag);
        setSiblingScheduleLoaded(true);
      } catch {
        setSiblingScheduleLoaded(false);
        setSchedulePath(siblingPath);
        if (!keepScheduleOnFail) {
          setScheduleData((prev) => prev ?? { moves: [] });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scenario");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScenarioAndSchedule(scenarioPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topology = (scenarioData?.topology as { nodes?: TopologyNode[]; edges?: TopologyEdge[] }) ?? {};
  const nodes = topology.nodes ?? [];
  const edges = (topology.edges ?? []).map((edge) => ({
    id: String(edge.id),
    from: String((edge as { from?: string; from_node?: string }).from ?? (edge as { from_node?: string }).from_node ?? ""),
    to: String((edge as { to?: string; to_node?: string }).to ?? (edge as { to_node?: string }).to_node ?? ""),
    duration_min: edge.duration_min,
  }));

  const entityOptions = useMemo(() => extractEntityIds(scenarioData), [scenarioData]);
  const edgeOptions = useMemo(() => extractEdgeIds(scenarioData), [scenarioData]);

  const scheduleMoves: ScheduleMove[] = useMemo(() => {
    const raw = (scheduleData?.moves as Array<{ entity?: string; edge?: string; start?: number }>) ?? [];
    return raw.map((move, index) => ({
      entity: String(move.entity ?? ""),
      edge: String(move.edge ?? ""),
      start: Number(move.start ?? 0),
      index,
    }));
  }, [scheduleData]);

  const optimizationDelta: OptimizationDelta | null = useMemo(() => {
    if (!optimizeResult && !optimizeBaselineResult) return null;
    return buildOptimizationDelta(
      optimizeBaselineResult,
      optimizeResult,
      preOptMoves ?? [],
      postOptMoves,
    );
  }, [optimizeBaselineResult, optimizeResult, preOptMoves, postOptMoves]);

  const timeline = useMemo(() => asTimeline(simulateResult?.timeline ?? []), [simulateResult]);

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

  const handleViewChange = (view: WorkbenchView) => {
    if (view === activeView) return;
    if (
      !confirmIfDirty(
        isDirty,
        "You have unsaved scenario or schedule changes. Switch tabs anyway?",
      )
    ) {
      return;
    }
    setActiveView(view);
  };

  const handleScenarioPathChange = (path: string) => {
    if (path === scenarioPath) return;
    if (
      !confirmIfDirty(
        isDirty,
        "You have unsaved changes. Load a different scenario anyway?",
      )
    ) {
      return;
    }
    void loadScenarioAndSchedule(path, true);
  };

  const saveScenarioData = async () => {
    if (!scenarioData) return;
    setLoading(true);
    setError(null);
    try {
      const saved = await saveScenario(scenarioPath, scenarioData, scenarioEtag);
      setScenarioEtag(saved.etag);
      setSavedScenarioSnapshot(snapshotData(scenarioData));
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
      setSavedScheduleSnapshot(snapshotData(scheduleData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAsScenario = async (path: string) => {
    if (!scenarioData) return;
    setLoading(true);
    setError(null);
    try {
      const saved = await saveScenario(path, scenarioData);
      const scenarioList = await listScenarios();
      setScenarios(scenarioList.includes(path) ? scenarioList : [...scenarioList, path]);
      setScenarioPath(path);
      setScenarioEtag(saved.etag);
      setSavedScenarioSnapshot(snapshotData(scenarioData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scenario as new path");
    } finally {
      setLoading(false);
    }
  };

  const revertScenario = () => {
    if (!savedScenarioSnapshot) return;
    setScenarioData(JSON.parse(savedScenarioSnapshot) as Record<string, unknown>);
  };

  const revertSchedule = () => {
    if (!savedScheduleSnapshot) return;
    setScheduleData(JSON.parse(savedScheduleSnapshot) as Record<string, unknown>);
  };

  const loadSiblingSchedule = async () => {
    const siblingPath = siblingSchedulePath(scenarioPath);
    setLoading(true);
    setError(null);
    try {
      const schedule = await getSchedule(siblingPath);
      setSchedulePath(siblingPath);
      setScheduleData(schedule.data);
      setSavedScheduleSnapshot(snapshotData(schedule.data));
      setScheduleEtag(schedule.etag);
      setSiblingScheduleLoaded(true);
    } catch (err) {
      setSiblingScheduleLoaded(false);
      setError(err instanceof Error ? err.message : "Failed to load sibling schedule");
    } finally {
      setLoading(false);
    }
  };

  const runSim = async () => {
    if (scheduleMismatch.kind === "incompatible") return;
    setLoading(true);
    setError(null);
    try {
      const result = await simulate(scenarioPath, schedulePath, runtimeMode);
      setSimulateResult(result);
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
    if (scheduleMismatch.kind === "incompatible") return;
    if (isScenarioDirty || isScheduleDirty) return;

    setLoading(true);
    setError(null);
    setOptimizeBaselineResult(null);
    setPreOptMoves(null);
    setPostOptMoves(null);
    setOptimizationAppliedToBuilder(false);

    const movesBefore = parseScheduleMoves(
      (scheduleData?.moves as Array<Record<string, unknown>>) ?? [],
    );
    setPreOptMoves(movesBefore);

    try {
      let baseline: RunResult | null = null;
      try {
        baseline = await simulate(scenarioPath, schedulePath, "continue_and_report");
        setOptimizeBaselineResult(baseline);
      } catch {
        setOptimizeBaselineResult(null);
      }

      const result = await optimize(scenarioPath, schedulePath);
      if (result.outcome === "feasible" && result.artifacts) {
        setOptimizeResult(result.artifacts);
        if (result.schedule?.moves) {
          const moves = result.schedule.moves;
          const parsedAfter = parseScheduleMoves(moves);
          setPostOptMoves(parsedAfter);
          setOptimizedMoveCount(moves.length);
        } else {
          setPostOptMoves(null);
          setOptimizedMoveCount(null);
        }
      } else {
        setOptimizeResult(result);
        setPostOptMoves(null);
        setOptimizedMoveCount(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setLoading(false);
    }
  };

  const applyOptimizationToBuilder = () => {
    if (!postOptMoves || postOptMoves.length === 0) return;
    setScheduleData((prev) => ({ ...(prev ?? {}), moves: postOptMoves }));
    setOptimizationAppliedToBuilder(true);
    setSelectedMoveIndex(null);
    setActiveView("builder");
  };

  const handleFork = async (stateAt: number, amendments: Record<string, unknown>, precedence?: string) => {
    if (
      !confirmIfDirty(
        isDirty,
        "You have unsaved changes. Fork scenario anyway?",
      )
    ) {
      return;
    }
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
      await loadScenarioAndSchedule(forked.path, true);
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
          <p>Build scenarios, simulate feasibility, and optimize schedules.</p>
        </div>
        <span className="badge">v1-alpha</span>
        <ViewTabs activeView={activeView} onChange={handleViewChange} disabled={loading} />
      </header>

      <div className="status-stack" aria-live="polite">
        {loading && (
          <p className="status" role="status">
            Loading...
          </p>
        )}
        {!loading && !error && (!scenarioData || !scheduleData) && (
          <p className="empty" role="status">
            No scenario data is loaded yet. Select a scenario in Builder or reload the workbench.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <main>
        <div
          role="tabpanel"
          id={viewPanelId("builder")}
          aria-labelledby="view-tab-builder"
          hidden={activeView !== "builder"}
          className="view-panel"
        >
          {activeView === "builder" && (
            <BuilderView
              scenarioPath={scenarioPath}
              scenarios={
                scenarios.includes(DEFAULT_SCENARIO)
                  ? scenarios
                  : [DEFAULT_SCENARIO, ...scenarios.filter((s) => s !== DEFAULT_SCENARIO)]
              }
              scenarioData={scenarioData}
              scheduleData={scheduleData}
              scheduleMismatch={scheduleMismatch}
              entityOptions={entityOptions}
              edgeOptions={edgeOptions}
              isScenarioDirty={isScenarioDirty}
              isScheduleDirty={isScheduleDirty}
              loading={loading}
              onScenarioChange={setScenarioData}
              onScheduleChange={setScheduleData}
              onScenarioPathChange={handleScenarioPathChange}
              onSaveScenario={() => void saveScenarioData()}
              onSaveSchedule={() => void saveScheduleData()}
              onSaveAsScenario={(path) => void handleSaveAsScenario(path)}
              onRevertScenario={revertScenario}
              onRevertSchedule={revertSchedule}
              onLoadSiblingSchedule={() => void loadSiblingSchedule()}
              onFork={(stateAt, amendments, precedence) => void handleFork(stateAt, amendments, precedence)}
              selectedMoveIndex={selectedMoveIndex}
              onSelectMove={selectMove}
              activeMoveIndices={playback.activeMoveIndices}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id={viewPanelId("simulate")}
          aria-labelledby="view-tab-simulate"
          hidden={activeView !== "simulate"}
          className="view-panel"
        >
          {activeView === "simulate" && (
            <SimulateView
              runtimeMode={runtimeMode}
              onRuntimeModeChange={setRuntimeMode}
              onRunSimulate={() => void runSim()}
              simulateResult={simulateResult}
              scheduleMismatch={scheduleMismatch}
              onGoToBuilder={() => setActiveView("builder")}
              loading={loading}
              moves={scheduleMoves}
              edges={edges}
              nodes={nodes}
              timeline={timeline}
              playback={playback}
              scrubTime={scrubTime}
              selectedMoveIndex={selectedMoveIndex}
              selectedEventIndex={selectedEventIndex}
              selectedEdgeId={selectedEdgeId}
              horizonMin={Number(scenarioData?.horizon_min ?? 0)}
              onSelectMove={selectMove}
              onScrub={setScrubTime}
              onSelectEvent={setSelectedEventIndex}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id={viewPanelId("optimize")}
          aria-labelledby="view-tab-optimize"
          hidden={activeView !== "optimize"}
          className="view-panel"
        >
          {activeView === "optimize" && (
            <OptimizeView
              scenarioPath={scenarioPath}
              schedulePath={schedulePath}
              optimizationAlgorithm={optimizationAlgorithm}
              onAlgorithmChange={setOptimizationAlgorithm}
              onRunOptimize={() => void runOpt()}
              optimizeResult={optimizeResult}
              optimizedMoveCount={optimizedMoveCount}
              optimizationDelta={optimizationDelta}
              hasPendingOptimization={postOptMoves !== null && postOptMoves.length > 0}
              optimizationAppliedToBuilder={optimizationAppliedToBuilder}
              onApplyToBuilder={applyOptimizationToBuilder}
              scheduleMismatch={scheduleMismatch}
              isScenarioDirty={isScenarioDirty}
              isScheduleDirty={isScheduleDirty}
              onGoToBuilder={() => setActiveView("builder")}
              loading={loading}
            />
          )}
        </div>
      </main>
    </div>
  );
}
