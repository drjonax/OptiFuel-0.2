import { useState } from "react";
import type { RunResult } from "../api";

type Props = {
  result: RunResult | null;
  disabled?: boolean;
};

type Tab = "manifest" | "timeline" | "violations" | "objective";

export function ArtifactBrowser({ result, disabled }: Props) {
  const [tab, setTab] = useState<Tab>("manifest");

  if (!result) {
    return (
      <section className="artifact-browser" aria-label="Run artifacts">
        <h3>Run Artifacts</h3>
        <p className="empty">No run artifacts yet. Simulate or optimize to inspect output bundles.</p>
      </section>
    );
  }

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: "manifest", label: "Manifest" },
    { id: "timeline", label: "Timeline", count: result.timeline?.length ?? 0 },
    { id: "violations", label: "Violations", count: result.violations?.length ?? 0 },
    { id: "objective", label: "Objective" },
  ];

  return (
    <section className="artifact-browser" aria-label="Run artifacts">
      <h3>Run Artifacts</h3>
      <div className="tablist" role="tablist" aria-label="Artifact sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "tab active" : "tab"}
            disabled={disabled}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? ` (${item.count})` : ""}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="artifact-panel">
        {tab === "manifest" && (
          <pre>{JSON.stringify(result.manifest ?? { note: "No manifest in this result" }, null, 2)}</pre>
        )}
        {tab === "timeline" && (
          <pre>{JSON.stringify(result.timeline ?? [], null, 2)}</pre>
        )}
        {tab === "violations" && (
          <pre>{JSON.stringify(result.violations ?? [], null, 2)}</pre>
        )}
        {tab === "objective" && (
          <pre>{JSON.stringify(result.objective ?? { total: result.score_total }, null, 2)}</pre>
        )}
      </div>
    </section>
  );
}
