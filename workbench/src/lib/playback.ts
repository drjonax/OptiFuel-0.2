export type TimelineEvent = {
  t_min: number;
  entity: string | null;
  kind: string;
  edge?: string | null;
  detail?: Record<string, unknown>;
};

export type ScheduleMove = {
  entity: string;
  edge: string;
  start: number;
  index: number;
};

export type TopologyNode = {
  id: string;
  type: string;
  unit?: string;
};

export type TopologyEdge = {
  id: string;
  from: string;
  to: string;
  duration_min?: { base_min?: number };
};

export type PlaybackState = {
  entityLocations: Record<string, string>;
  occupantsByNode: Record<string, string[]>;
  activeEdges: Set<string>;
  activeMoveIndices: Set<number>;
  completedMoveIndices: Set<number>;
  visibleEventIndices: number[];
};

export function buildInitialLocations(
  entities: Array<{ id: string; location: string }>,
): Record<string, string> {
  const locations: Record<string, string> = {};
  for (const entity of entities) {
    locations[entity.id] = entity.location;
  }
  return locations;
}

export function derivePlaybackState(
  scrubTime: number,
  timeline: TimelineEvent[],
  moves: ScheduleMove[],
  edges: TopologyEdge[],
  initialLocations: Record<string, string>,
): PlaybackState {
  const entityLocations = { ...initialLocations };
  const edgeMap = Object.fromEntries(edges.map((edge) => [edge.id, edge]));
  const activeEdges = new Set<string>();
  const activeMoveIndices = new Set<number>();
  const completedMoveIndices = new Set<number>();
  const visibleEventIndices: number[] = [];

  const sortedMoves = [...moves].sort((a, b) => a.start - b.start || a.index - b.index);

  for (const [eventIndex, event] of timeline.entries()) {
    if (event.t_min > scrubTime) {
      break;
    }
    visibleEventIndices.push(eventIndex);

    if (event.kind === "move_started" && event.entity && event.edge) {
      activeEdges.add(event.edge);
      const moveIdx = sortedMoves.findIndex(
        (move) => move.entity === event.entity && move.edge === event.edge && move.start <= scrubTime,
      );
      if (moveIdx >= 0) {
        activeMoveIndices.add(sortedMoves[moveIdx].index);
      }
    }

    if (event.kind === "move_completed" && event.entity && event.edge) {
      activeEdges.delete(event.edge);
      const edge = edgeMap[event.edge];
      if (edge) {
        entityLocations[event.entity] = edge.to;
      }
      const moveIdx = sortedMoves.findIndex(
        (move) => move.entity === event.entity && move.edge === event.edge && move.start <= scrubTime,
      );
      if (moveIdx >= 0) {
        activeMoveIndices.delete(sortedMoves[moveIdx].index);
        completedMoveIndices.add(sortedMoves[moveIdx].index);
      }
    }

    if (event.kind === "entity_created" && event.entity) {
      const arrivalNode = String(event.detail?.node_id ?? "");
      if (arrivalNode) {
        entityLocations[event.entity] = arrivalNode;
      }
    }

    if (event.kind === "entity_departed" && event.entity) {
      entityLocations[event.entity] = "departed";
    }
  }

  // Fallback: highlight scheduled moves that should be in progress based on duration.
  for (const move of sortedMoves) {
    const edge = edgeMap[move.edge];
    const duration = edge?.duration_min?.base_min ?? 60;
    if (move.start <= scrubTime && move.start + duration > scrubTime) {
      activeMoveIndices.add(move.index);
      activeEdges.add(move.edge);
    }
    if (move.start + duration <= scrubTime) {
      completedMoveIndices.add(move.index);
    }
  }

  const occupantsByNode: Record<string, string[]> = {};
  for (const [entityId, location] of Object.entries(entityLocations)) {
    if (location === "departed") {
      continue;
    }
    occupantsByNode[location] = [...(occupantsByNode[location] ?? []), entityId].sort();
  }

  return {
    entityLocations,
    occupantsByNode,
    activeEdges,
    activeMoveIndices,
    completedMoveIndices,
    visibleEventIndices,
  };
}

export function moveDuration(edgeId: string, edges: TopologyEdge[], fallback = 60): number {
  const edge = edges.find((item) => item.id === edgeId);
  return edge?.duration_min?.base_min ?? fallback;
}
