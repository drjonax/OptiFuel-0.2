import type { KeyboardEvent } from "react";

export type WorkbenchView = "builder" | "simulate" | "optimize";

type TabDef = { id: WorkbenchView; label: string; panelId: string };

const TABS: TabDef[] = [
  { id: "builder", label: "Build", panelId: "view-panel-builder" },
  { id: "simulate", label: "Simulate", panelId: "view-panel-simulate" },
  { id: "optimize", label: "Optimize", panelId: "view-panel-optimize" },
];

type Props = {
  activeView: WorkbenchView;
  onChange: (view: WorkbenchView) => void;
  disabled?: boolean;
};

export function ViewTabs({ activeView, onChange, disabled }: Props) {
  const tabIds = TABS.map((t) => t.id);
  const activeIndex = tabIds.indexOf(activeView);

  const focusTab = (index: number) => {
    const tab = TABS[index];
    if (tab) {
      onChange(tab.id);
      requestAnimationFrame(() => {
        document.getElementById(`view-tab-${tab.id}`)?.focus();
      });
    }
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    if (disabled) return;
    let nextIndex = index;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % TABS.length;
        event.preventDefault();
        focusTab(nextIndex);
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + TABS.length) % TABS.length;
        event.preventDefault();
        focusTab(nextIndex);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(TABS.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="view-tabs app-section-nav" role="tablist" aria-label="Workbench views">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`view-tab-${tab.id}`}
          aria-selected={activeView === tab.id}
          aria-controls={tab.panelId}
          tabIndex={activeView === tab.id ? 0 : -1}
          className={activeView === tab.id ? "view-tab active" : "view-tab"}
          disabled={disabled}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => onKeyDown(e, index)}
        >
          {tab.label}
        </button>
      ))}
      <span className="sr-only" aria-live="polite">
        {activeIndex >= 0 ? `${TABS[activeIndex].label} view selected` : ""}
      </span>
    </div>
  );
}

export function viewPanelId(view: WorkbenchView): string {
  return `view-panel-${view}`;
}
