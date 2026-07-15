import { useState } from "react";
import { ScheduleEditor } from "../ScheduleEditor";
import { GlobalParametersPanel } from "../GlobalParametersPanel";
import { StartingConditionsPanel } from "../StartingConditionsPanel";
import type { ScheduleMismatch } from "../../lib/scenarioSchedule";
import { isValidSaveAsScenarioPath } from "../../lib/scenarioSchedule";

type Props = {
  scenarioPath: string;
  scenarios: string[];
  scenarioData: Record<string, unknown> | null;
  scheduleData: Record<string, unknown> | null;
  scheduleMismatch: ScheduleMismatch;
  entityOptions: string[];
  edgeOptions: string[];
  edgesForEntity?: (entityId: string) => string[];
  entityHomeUnits?: Record<string, string | null | undefined>;
  unitIds: string[];
  isScenarioDirty: boolean;
  isScheduleDirty: boolean;
  loading: boolean;
  onScenarioChange: (data: Record<string, unknown>) => void;
  onScheduleChange: (data: Record<string, unknown>) => void;
  onScenarioPathChange: (path: string) => void;
  onSaveScenario: () => void;
  onSaveSchedule: () => void;
  onSaveAsScenario: (path: string) => void;
  onRevertScenario: () => void;
  onRevertSchedule: () => void;
  onLoadSiblingSchedule: () => void;
  onAddEfa: (homeUnit: string) => void;
  onAddUnit: () => void;
  addEfaHomeUnit: string;
  onAddEfaHomeUnitChange: (unitId: string) => void;
  unitIds: string[];
  onMutationError: (message: string) => void;
  selectedMoveIndex: number | null;
  onSelectMove: (index: number) => void;
  activeMoveIndices: Set<number>;
};

function BuilderControls({
  scenarioPath,
  scenarios,
  scenarioData,
  isScenarioDirty,
  isScheduleDirty,
  loading,
  onScenarioPathChange,
  onSaveScenario,
  onRevertScenario,
  onSaveAsScenario,
}: Pick<
  Props,
  | "scenarioPath"
  | "scenarios"
  | "scenarioData"
  | "isScenarioDirty"
  | "isScheduleDirty"
  | "loading"
  | "onScenarioPathChange"
  | "onSaveScenario"
  | "onRevertScenario"
  | "onSaveAsScenario"
>) {
  const [saveAsPath, setSaveAsPath] = useState("");

  const handleSaveAs = () => {
    const trimmed = saveAsPath.trim();
    if (!isValidSaveAsScenarioPath(trimmed)) {
      window.alert("Save-as path must match examples/**/scenario.yaml");
      return;
    }
    if (scenarios.includes(trimmed)) {
      const ok = window.confirm(`Scenario "${trimmed}" already exists. Overwrite?`);
      if (!ok) return;
    }
    onSaveAsScenario(trimmed);
    setSaveAsPath("");
  };

  return (
    <div className="builder-controls">
      <header className="section-header">
        <h2 id="builder-scenario-heading">Scenario</h2>
        <div className="header-badges">
          {isScenarioDirty && <span className="badge badge-dirty">Scenario unsaved</span>}
          {isScheduleDirty && <span className="badge badge-dirty">Schedule unsaved</span>}
        </div>
      </header>

      <label htmlFor="builder-scenario-selector">
        Load scenario
        <select
          id="builder-scenario-selector"
          value={scenarioPath}
          onChange={(e) => onScenarioPathChange(e.target.value)}
          aria-label="Scenario selector"
          disabled={loading}
        >
          {scenarios.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={onSaveScenario} disabled={loading || !scenarioData}>
          Save Scenario
        </button>
        {isScenarioDirty && (
          <button type="button" className="btn btn-secondary" onClick={onRevertScenario} disabled={loading}>
            Revert Scenario
          </button>
        )}
      </div>

      <div className="save-as-row">
        <label htmlFor="save-as-path">
          Save as new scenario
          <input
            id="save-as-path"
            type="text"
            placeholder="examples/my_plant/scenario.yaml"
            value={saveAsPath}
            disabled={loading}
            onChange={(e) => setSaveAsPath(e.target.value)}
            aria-describedby="save-as-hint"
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSaveAs}
          disabled={loading || !saveAsPath.trim() || !scenarioData}
        >
          Save As
        </button>
      </div>
      <p id="save-as-hint" className="hint">
        Path must be under examples/**/scenario.yaml to appear in the scenario list.
      </p>
    </div>
  );
}

export function BuilderView({
  scenarioPath,
  scenarios,
  scenarioData,
  scheduleData,
  scheduleMismatch,
  entityOptions,
  edgeOptions,
  edgesForEntity,
  entityHomeUnits,
  unitIds,
  isScenarioDirty,
  isScheduleDirty,
  loading,
  onScenarioChange,
  onScheduleChange,
  onScenarioPathChange,
  onSaveScenario,
  onSaveSchedule,
  onSaveAsScenario,
  onRevertScenario,
  onRevertSchedule,
  onLoadSiblingSchedule,
  onAddEfa,
  onAddUnit,
  addEfaHomeUnit,
  onAddEfaHomeUnitChange,
  onMutationError,
  selectedMoveIndex,
  onSelectMove,
  activeMoveIndices,
}: Props) {
  const [codeViewerOpen, setCodeViewerOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 901px)").matches,
  );

  return (
    <div className="view-layout builder-layout">
      <div className="builder-main">
        {scheduleMismatch.kind !== "none" && (
          <div className="warning-banner" role="alert">
            <p>{scheduleMismatch.message}</p>
            {scheduleMismatch.kind === "missing_sibling" && (
              <button type="button" className="btn btn-secondary" onClick={onLoadSiblingSchedule} disabled={loading}>
                Retry load sibling schedule
              </button>
            )}
          </div>
        )}

        <section className="panel builder-section">
          <GlobalParametersPanel
            data={scenarioData}
            onChange={onScenarioChange}
            onMutationError={onMutationError}
            disabled={loading}
          />
          <StartingConditionsPanel
            scenarioData={scenarioData}
            scheduleData={scheduleData}
            onScenarioChange={onScenarioChange}
            onScheduleChange={onScheduleChange}
            onMutationError={onMutationError}
            disabled={loading}
          />

          <div className="topology-fleet-actions">
            <h3 id="topology-fleet-heading">Topology &amp; Fleet Actions</h3>
            <p className="hint" id="topology-fleet-hint">
              Add a new assembly (EFA) with default physics and a staggered `fresh_to_staging` seed move, or scaffold
              a reactor unit with core, pool, edges, unit mode, and shared resource wiring.
            </p>
            <div className="button-row builder-fleet-controls" role="group" aria-labelledby="topology-fleet-heading">
              <label htmlFor="add-efa-unit" className="builder-inline-label">
                Home unit
                <select
                  id="add-efa-unit"
                  value={addEfaHomeUnit}
                  disabled={loading || !scenarioData || unitIds.length === 0}
                  onChange={(e) => onAddEfaHomeUnitChange(e.target.value)}
                  aria-describedby="topology-fleet-hint"
                >
                  {unitIds.length === 0 ? (
                    <option value="">No units</option>
                  ) : (
                    unitIds.map((unitId) => (
                      <option key={unitId} value={unitId}>
                        {unitId}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onAddEfa(addEfaHomeUnit)}
                disabled={loading || !scenarioData || unitIds.length === 0 || !addEfaHomeUnit}
                aria-describedby="topology-fleet-hint"
              >
                Add EFA
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onAddUnit}
                disabled={loading || !scenarioData}
                aria-describedby="topology-fleet-hint"
              >
                Add Unit
              </button>
            </div>
          </div>
        </section>

        <section className="panel builder-section builder-section-schedule">
          <ScheduleEditor
            data={scheduleData}
            onChange={onScheduleChange}
            onSave={onSaveSchedule}
            onRevert={isScheduleDirty ? onRevertSchedule : undefined}
            entityOptions={entityOptions}
            edgeOptions={edgeOptions}
            edgesForEntity={edgesForEntity}
            entityHomeUnits={entityHomeUnits}
            unitIds={unitIds}
            selectedMoveIndex={selectedMoveIndex}
            onSelectMove={onSelectMove}
            activeMoveIndices={activeMoveIndices}
            disabled={loading}
          />
        </section>

        <section className="panel builder-section code-viewer-section">
          <div className="collapsible-panel-header">
            <h2>Code Viewer</h2>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => setCodeViewerOpen((value) => !value)}
              aria-expanded={codeViewerOpen}
            >
              {codeViewerOpen ? "Hide" : "Show"}
            </button>
          </div>
          {codeViewerOpen && (
            <>
              {!scenarioData ? (
                <p className="empty">No scenario loaded.</p>
              ) : (
                <pre className="yaml-preview code-viewer" aria-label="Scenario JSON preview">
                  {JSON.stringify(scenarioData, null, 2)}
                </pre>
              )}
            </>
          )}
        </section>
      </div>

      <aside className="builder-sidebar">
        <section className="panel builder-section">
          <BuilderControls
            scenarioPath={scenarioPath}
            scenarios={scenarios}
            scenarioData={scenarioData}
            isScenarioDirty={isScenarioDirty}
            isScheduleDirty={isScheduleDirty}
            loading={loading}
            onScenarioPathChange={onScenarioPathChange}
            onSaveScenario={onSaveScenario}
            onRevertScenario={onRevertScenario}
            onSaveAsScenario={onSaveAsScenario}
          />
        </section>
      </aside>
    </div>
  );
}
