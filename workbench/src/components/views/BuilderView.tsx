import { useState } from "react";
import { ForkPanel } from "../ForkPanel";
import { ScheduleEditor } from "../ScheduleEditor";
import { ScenarioParamsPanel } from "../ScenarioParamsPanel";
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
  onFork: (stateAt: number, amendments: Record<string, unknown>, precedence?: string) => void;
  onAddEfa: () => void;
  onAddUnit: () => void;
  selectedMoveIndex: number | null;
  onSelectMove: (index: number) => void;
  activeMoveIndices: Set<number>;
};

export function BuilderView({
  scenarioPath,
  scenarios,
  scenarioData,
  scheduleData,
  scheduleMismatch,
  entityOptions,
  edgeOptions,
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
  onFork,
  onAddEfa,
  onAddUnit,
  selectedMoveIndex,
  onSelectMove,
  activeMoveIndices,
}: Props) {
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
    <div className="view-layout builder-layout">
      <section className="panel builder-section">
        <header className="section-header">
          <h2 id="builder-scenario-heading">Scenario Builder</h2>
          <div className="header-badges">
            {isScenarioDirty && <span className="badge badge-dirty">Scenario unsaved</span>}
            {isScheduleDirty && <span className="badge badge-dirty">Schedule unsaved</span>}
          </div>
        </header>

        <div className="builder-controls">
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

        <ScenarioParamsPanel data={scenarioData} onChange={onScenarioChange} disabled={loading} />

        <div className="topology-fleet-actions">
          <h3 id="topology-fleet-heading">Topology &amp; Fleet Actions</h3>
          <p className="hint" id="topology-fleet-hint">
            Add a new assembly (EFA) with default physics, or scaffold a reactor unit with core, pool,
            edges, unit mode, and shared resource wiring. Changes stay unsaved until you save the scenario.
          </p>
          <div className="button-row" role="group" aria-labelledby="topology-fleet-heading">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onAddEfa}
              disabled={loading || !scenarioData}
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
          selectedMoveIndex={selectedMoveIndex}
          onSelectMove={onSelectMove}
          activeMoveIndices={activeMoveIndices}
          disabled={loading}
        />
      </section>

      <section className="panel builder-section code-viewer-section">
        <h2>Code Viewer</h2>
        {!scenarioData ? (
          <p className="empty">No scenario loaded.</p>
        ) : (
          <pre className="yaml-preview code-viewer" aria-label="Scenario JSON preview">
            {JSON.stringify(scenarioData, null, 2)}
          </pre>
        )}
      </section>

      <section className="panel builder-section">
        <ForkPanel disabled={loading} onFork={onFork} />
      </section>
    </div>
  );
}
