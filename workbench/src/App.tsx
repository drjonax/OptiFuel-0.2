import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getOptimizeCapabilities,
  getScenario,
  getSchedule,
  listScenarios,
  optimize,
  saveScenario,
  saveSchedule,
  simulate,
  type MatrixLockCapabilities,
  type RunResult,
  type StructureLockMode,
  type TunableParamRef,
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
import { addEfa, addUnitScaffold } from "./lib/scenarioMutations";
import { collectUnitIds, defaultHomeUnitForNewEfa, edgeUnitFromId, FRESH_TO_STAGING_EDGE } from "./lib/scenarioHelpers";

const DEFAULT_SCENARIO = "examples/reference_plant/scenario.yaml";
const AUTOSAVE_DEBOUNCE_MS = 1200;
const AUTOSAVE_STATUS_RESET_MS = 1800;

const VIEW_META: Record<
  WorkbenchView,
  { subtitle: string }
> = {
  builder: { subtitle: "Build scenarios and schedules" },
  simulate: { subtitle: "Simulate feasibility and playback" },
  optimize: { subtitle: "Optimize schedule timing" },
};

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

type TunableParamOption = {
  key: string;
  entityId: string;
  constraintId: string;
  constraintType: string;
  paramName: string;
};

function tuningParamKey(entityId: string, constraintId: string, paramName: string): string {
  return `${entityId}|${constraintId}|${paramName}`;
}

function buildTunableParamOptions(capabilities: MatrixLockCapabilities | null): TunableParamOption[] {
  if (!capabilities) return [];
  const globalId = capabilities.global_entity_id ?? "__global__";
  const entityIds = [globalId, ...capabilities.entities];
  const options: TunableParamOption[] = [];
  for (const entityId of entityIds) {
    for (const constraint of capabilities.constraints) {
      if (!capabilities.applicability[entityId]?.[constraint.id]) continue;
      const tunableParams = capabilities.tunable_params_by_constraint[constraint.id] ?? [];
      for (const paramName of tunableParams) {
        options.push({
          key: tuningParamKey(entityId, constraint.id, paramName),
          entityId,
          constraintId: constraint.id,
          constraintType: constraint.type,
          paramName,
        });
      }
    }
  }
  return options.sort((a, b) =>
    a.entityId.localeCompare(b.entityId) ||
    a.constraintId.localeCompare(b.constraintId) ||
    a.paramName.localeCompare(b.paramName),
  );
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
  const [structureMode, setStructureMode] = useState<StructureLockMode>("locked");
  const [tuningPolicyEnabled, setTuningPolicyEnabled] = useState(false);
  const [tunableParamAllowlist, setTunableParamAllowlist] = useState<Set<string>>(() => new Set());
  const [lockCapabilities, setLockCapabilities] = useState<MatrixLockCapabilities | null>(null);
  const [lockCapabilitiesLoading, setLockCapabilitiesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
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
  const [addEfaHomeUnit, setAddEfaHomeUnit] = useState("");
  const scenarioSaveInFlightRef = useRef(false);
  const scheduleSaveInFlightRef = useRef(false);
  const autosaveStatusTimerRef = useRef<number | null>(null);

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

  const lockMatrixPathsReady = Boolean(scenarioPath);
  const tunableParamOptions = useMemo(() => buildTunableParamOptions(lockCapabilities), [lockCapabilities]);

  useEffect(() => {
    if (!lockMatrixPathsReady) {
      return;
    }
    let cancelled = false;
    setLockCapabilitiesLoading(true);
    void getOptimizeCapabilities(scenarioPath, schedulePath)
      .then((caps) => {
        if (!cancelled) setLockCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setLockCapabilities(null);
      })
      .finally(() => {
        if (!cancelled) setLockCapabilitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lockMatrixPathsReady, scenarioPath, schedulePath]);

  useEffect(() => {
    setTunableParamAllowlist((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(tunableParamOptions.map((option) => option.key));
      const next = new Set(Array.from(prev).filter((key) => validKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [tunableParamOptions]);

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
  const unitIds = useMemo(() => collectUnitIds(scenarioData ?? {}), [scenarioData]);

  const entityHomeUnits = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    for (const entity of (scenarioData?.entities as Array<{ id?: string; home_unit?: string | null }>) ?? []) {
      if (entity.id) map[entity.id] = entity.home_unit;
    }
    return map;
  }, [scenarioData]);

  const edgesForEntity = useCallback(
    (entityId: string): string[] => {
      if (!scenarioData) return edgeOptions;
      const homeUnit = entityHomeUnits[entityId];
      if (!homeUnit) return edgeOptions;
      return edgeOptions.filter((edgeId) => {
        if (edgeId === FRESH_TO_STAGING_EDGE) return true;
        const edgeUnit = edgeUnitFromId(edgeId, unitIds);
        return edgeUnit === null || edgeUnit === homeUnit;
      });
    },
    [scenarioData, edgeOptions, entityHomeUnits, unitIds],
  );

  useEffect(() => {
    if (!scenarioData) {
      setAddEfaHomeUnit("");
      return;
    }
    const defaultUnit = defaultHomeUnitForNewEfa(scenarioData);
    setAddEfaHomeUnit((current) =>
      current && unitIds.includes(current) ? current : (defaultUnit ?? unitIds[0] ?? ""),
    );
  }, [scenarioData, unitIds]);

  const scheduleMoves: ScheduleMove[] = useMemo(() => {
    const raw = (scheduleData?.moves as Array<{ entity?: string; edge?: string; start?: number }>) ?? [];
    return raw.map((move, index) => ({
      entity: String(move.entity ?? ""),
      edge: String(move.edge ?? ""),
      start: Number(move.start ?? 0),
      index,
    }));
  }, [scheduleData]);

  const handleTuningPolicyEnabledChange = (enabled: boolean) => {
    setTuningPolicyEnabled(enabled);
  };

  const toggleTunableParam = (entityId: string, constraintId: string, paramName: string, allowed: boolean) => {
    const key = tuningParamKey(entityId, constraintId, paramName);
    setTunableParamAllowlist((prev) => {
      const next = new Set(prev);
      if (allowed) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectAllTunableParams = () => {
    setTunableParamAllowlist(new Set(tunableParamOptions.map((option) => option.key)));
  };

  const clearAllTunableParams = () => {
    setTunableParamAllowlist(new Set());
  };

  const optimizationDelta: OptimizationDelta | null = useMemo(() => {
    if (!optimizeResult && !optimizeBaselineResult) return null;
    let outcome: "feasible" | "infeasible_or_timeout" | null = null;
    if (optimizeResult) {
      if ("outcome" in optimizeResult && optimizeResult.outcome) {
        outcome = optimizeResult.outcome as "feasible" | "infeasible_or_timeout";
      } else if (postOptMoves !== null) {
        outcome = "feasible";
      }
    }
    return buildOptimizationDelta(
      optimizeBaselineResult,
      optimizeResult,
      preOptMoves ?? [],
      postOptMoves,
      outcome,
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

  const clearAutosaveStatusTimer = useCallback(() => {
    if (autosaveStatusTimerRef.current !== null) {
      window.clearTimeout(autosaveStatusTimerRef.current);
      autosaveStatusTimerRef.current = null;
    }
  }, []);

  const setAutosaveState = useCallback(
    (next: "idle" | "pending" | "saving" | "saved" | "error") => {
      clearAutosaveStatusTimer();
      setAutosaveStatus(next);
      if (next === "saved") {
        autosaveStatusTimerRef.current = window.setTimeout(() => {
          setAutosaveStatus("idle");
          autosaveStatusTimerRef.current = null;
        }, AUTOSAVE_STATUS_RESET_MS);
      }
    },
    [clearAutosaveStatusTimer],
  );

  const saveScenarioData = useCallback(async (options?: { silent?: boolean }) => {
    if (!scenarioData) return;
    if (scenarioSaveInFlightRef.current) return;
    scenarioSaveInFlightRef.current = true;
    if (options?.silent) {
      setAutosaveState("saving");
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const saved = await saveScenario(scenarioPath, scenarioData, scenarioEtag);
      setScenarioEtag(saved.etag);
      setSavedScenarioSnapshot(snapshotData(scenarioData));
      if (options?.silent) {
        setAutosaveState("saved");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save scenario");
      if (options?.silent) {
        setAutosaveState("error");
      }
    } finally {
      scenarioSaveInFlightRef.current = false;
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [scenarioData, scenarioEtag, scenarioPath, setAutosaveState]);

  const saveScheduleData = useCallback(async (options?: { silent?: boolean }) => {
    if (!scheduleData) return;
    if (scheduleSaveInFlightRef.current) return;
    scheduleSaveInFlightRef.current = true;
    if (options?.silent) {
      setAutosaveState("saving");
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const saved = await saveSchedule(schedulePath, scheduleData, scheduleEtag);
      setScheduleEtag(saved.etag);
      setSavedScheduleSnapshot(snapshotData(scheduleData));
      if (options?.silent) {
        setAutosaveState("saved");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
      if (options?.silent) {
        setAutosaveState("error");
      }
    } finally {
      scheduleSaveInFlightRef.current = false;
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [scheduleData, scheduleEtag, schedulePath, setAutosaveState]);

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

      const lockOptions = {
        lock_mode: "enforced" as const,
        structure_mode: structureMode,
      };

      const tuningPolicy = tuningPolicyEnabled
        ? {
            allow_tunable_params: tunableParamOptions
              .filter((option) => tunableParamAllowlist.has(option.key))
              .map<TunableParamRef>((option) => ({
                entity_id: option.entityId,
                constraint_id: option.constraintId,
                param_name: option.paramName,
              })),
          }
        : undefined;

      const result = await optimize(scenarioPath, schedulePath, lockOptions, tuningPolicy);
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

  const handleMutationError = (message: string) => {
    setError(message ? message : null);
  };

  useEffect(() => {
    return () => clearAutosaveStatusTimer();
  }, [clearAutosaveStatusTimer]);

  useEffect(() => {
    if (!scenarioData && !scheduleData) {
      setAutosaveState("idle");
      return;
    }
    if (loading) return;
    if (!isScenarioDirty && !isScheduleDirty) {
      if (autosaveStatus !== "error") {
        setAutosaveState("idle");
      }
      return;
    }

    if (autosaveStatus !== "saving") {
      setAutosaveState("pending");
    }
    const timerId = window.setTimeout(() => {
      if (isScenarioDirty) {
        void saveScenarioData({ silent: true });
      }
      if (isScheduleDirty) {
        void saveScheduleData({ silent: true });
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    autosaveStatus,
    isScenarioDirty,
    isScheduleDirty,
    loading,
    saveScenarioData,
    saveScheduleData,
    scenarioData,
    scheduleData,
    setAutosaveState,
  ]);

  const handleAddEfa = (homeUnit: string) => {
    if (!scenarioData) return;
    const result = addEfa(scenarioData, homeUnit, scheduleData);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setScenarioData(result.scenario);

    if (scheduleData) {
      const moves = [...((scheduleData.moves as Array<Record<string, unknown>>) ?? []), result.scheduleSeed];
      setScheduleData({ ...scheduleData, moves });
    } else {
      setScheduleData({
        schema_version: 4,
        scenario: String(scenarioData.id ?? "scenario"),
        moves: [result.scheduleSeed],
      });
      setSiblingScheduleLoaded(true);
    }
  };

  const handleAddUnit = () => {
    if (!scenarioData) return;
    const result = addUnitScaffold(scenarioData);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setScenarioData(result.scenario);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <div className="header-title">
            <h1>OptiFuel Workbench</h1>
            <p className="header-subtitle">{VIEW_META[activeView].subtitle}</p>
          </div>
          <div className="header-toolbar">
            <div className="header-badges-row">
              <span className="badge">v1-alpha</span>
              {isScenarioDirty && <span className="badge badge-dirty">Scenario unsaved</span>}
              {isScheduleDirty && <span className="badge badge-dirty">Schedule unsaved</span>}
              {autosaveStatus === "pending" && <span className="badge">Autosave pending</span>}
              {autosaveStatus === "saving" && <span className="badge">Autosaving...</span>}
              {autosaveStatus === "saved" && <span className="badge">Autosaved</span>}
              {autosaveStatus === "error" && <span className="badge badge-dirty">Autosave failed</span>}
            </div>
            <ViewTabs activeView={activeView} onChange={handleViewChange} disabled={loading} />
          </div>
        </div>
      </header>

      <div className="banner-row" aria-live="polite">
        {loading && (
          <p className="status banner info" role="status">
            Loading...
          </p>
        )}
        {!loading && !error && (!scenarioData || !scheduleData) && (
          <p className="empty banner info" role="status">
            No scenario data is loaded yet. Select a scenario in Builder or reload the workbench.
          </p>
        )}
        {error && (
          <p className="error banner warn" role="alert">
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
              edgesForEntity={edgesForEntity}
              entityHomeUnits={entityHomeUnits}
              unitIds={unitIds}
              isScenarioDirty={isScenarioDirty}
              isScheduleDirty={isScheduleDirty}
              loading={loading}
              onScenarioChange={setScenarioData}
              onScheduleChange={setScheduleData}
              onScenarioPathChange={handleScenarioPathChange}
              onSaveScenario={() => void saveScenarioData({ silent: false })}
              onSaveSchedule={() => void saveScheduleData({ silent: false })}
              onSaveAsScenario={(path) => void handleSaveAsScenario(path)}
              onRevertScenario={revertScenario}
              onRevertSchedule={revertSchedule}
              onLoadSiblingSchedule={() => void loadSiblingSchedule()}
              onAddEfa={handleAddEfa}
              onAddUnit={handleAddUnit}
              addEfaHomeUnit={addEfaHomeUnit}
              onAddEfaHomeUnitChange={setAddEfaHomeUnit}
              onMutationError={handleMutationError}
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
              structureMode={structureMode}
              onStructureModeChange={setStructureMode}
              lockCapabilities={lockCapabilities}
              lockCapabilitiesLoading={lockCapabilitiesLoading}
              tuningPolicyEnabled={tuningPolicyEnabled}
              onTuningPolicyEnabledChange={handleTuningPolicyEnabledChange}
              tunableParamOptions={tunableParamOptions}
              tunableParamAllowlist={tunableParamAllowlist}
              onToggleTunableParam={toggleTunableParam}
              onSelectAllTunableParams={selectAllTunableParams}
              onClearAllTunableParams={clearAllTunableParams}
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
