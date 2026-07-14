import type { PlaybackState, TopologyEdge, TopologyNode } from "../lib/playback";

type Props = {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  playback: PlaybackState;
  scrubTime: number;
  selectedEdgeId: string | null;
  disabled?: boolean;
  hasRunData: boolean;
};

export function TopologyView({
  nodes,
  edges,
  playback,
  scrubTime,
  selectedEdgeId,
  disabled,
  hasRunData,
}: Props) {
  if (nodes.length === 0) {
    return (
      <section className="topology" aria-label="Topology view">
        <h3>Topology</h3>
        <p className="empty">Topology unavailable. Load a scenario with graph nodes.</p>
      </section>
    );
  }

  const selectedEdge = selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) : null;

  return (
    <section className="topology" aria-label="Topology view">
      <h3>Topology</h3>
      {!hasRunData && (
        <p className="hint" role="status">
          Run a simulation to animate occupancy and active transfers.
        </p>
      )}
      <div className="node-grid" role="list" aria-label="Plant nodes">
        {nodes.map((node) => {
          const occupants = playback.occupantsByNode[node.id] ?? [];
          const isActive = occupants.length > 0;
          return (
            <div
              key={node.id}
              role="listitem"
              className={`node-card type-${node.type} ${isActive ? "is-active" : ""}`}
              aria-label={`${node.id} ${node.type}${occupants.length ? `, ${occupants.length} assemblies` : ""}`}
            >
              <strong>{node.id}</strong>
              <span className="node-type">{node.type}</span>
              <span className="node-unit">{node.unit ?? "shared"}</span>
              {occupants.length > 0 && (
                <ul className="occupant-list" aria-label={`Assemblies at ${node.id}`}>
                  {occupants.map((entityId) => (
                    <li key={entityId}>{entityId}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <ul className="edge-list" aria-label="Transfer edges">
        {edges.map((edge) => {
          const active = playback.activeEdges.has(edge.id);
          const selected = selectedEdge?.id === edge.id;
          return (
            <li
              key={edge.id}
              className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`}
              aria-current={selected ? "true" : undefined}
            >
              <span className="edge-label">
                {edge.from} → {edge.to}
              </span>
              <span className="edge-meta">{edge.id}</span>
              {active && <span className="edge-state" aria-label="Transfer in progress">In transit</span>}
            </li>
          );
        })}
      </ul>
      <p className="topology-time" aria-live="polite">
        Simulation time: <strong>{scrubTime} min</strong>
        {disabled ? " (playback disabled while saving or running)" : ""}
      </p>
    </section>
  );
}
