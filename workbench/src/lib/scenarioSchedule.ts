/** Path helpers and compatibility checks for scenario/schedule pairing. */

export function siblingSchedulePath(scenarioPath: string): string {
  if (scenarioPath.endsWith("/scenario.yaml")) {
    return scenarioPath.replace(/\/scenario\.yaml$/, "/schedule.yaml");
  }
  const lastSlash = scenarioPath.lastIndexOf("/");
  if (lastSlash >= 0) {
    return `${scenarioPath.slice(0, lastSlash)}/schedule.yaml`;
  }
  return "schedule.yaml";
}

/** Discoverable save-as paths must match examples/.../scenario.yaml */
export function isValidSaveAsScenarioPath(path: string): boolean {
  return /^examples\/(?:.+\/)?scenario\.yaml$/.test(path.trim());
}

export type ScheduleMismatch =
  | { kind: "none" }
  | { kind: "missing_sibling"; siblingPath: string; message: string }
  | { kind: "incompatible"; message: string; invalidEntities: string[]; invalidEdges: string[] };

export function detectScheduleMismatch(
  scenarioData: Record<string, unknown> | null,
  scheduleData: Record<string, unknown> | null,
  siblingLoaded: boolean,
  siblingPath: string,
): ScheduleMismatch {
  if (!scenarioData || !scheduleData) {
    return { kind: "none" };
  }

  if (!siblingLoaded) {
    return {
      kind: "missing_sibling",
      siblingPath,
      message: `No sibling schedule found at ${siblingPath}. Current schedule may not match this scenario.`,
    };
  }

  const entities = new Set(
    ((scenarioData.entities as Array<{ id?: string }>) ?? [])
      .map((e) => e.id)
      .filter(Boolean) as string[],
  );
  const edgeIds = new Set(
    (
      (scenarioData.topology as { edges?: Array<{ id?: string }> })?.edges ?? []
    )
      .map((e) => e.id)
      .filter(Boolean) as string[],
  );

  const moves = (scheduleData.moves as Array<{ entity?: string; edge?: string }>) ?? [];
  const invalidEntities = [
    ...new Set(moves.map((m) => m.entity).filter((id) => id && !entities.has(id)) as string[]),
  ];
  const invalidEdges = [
    ...new Set(moves.map((m) => m.edge).filter((id) => id && !edgeIds.has(id)) as string[]),
  ];

  if (invalidEntities.length > 0 || invalidEdges.length > 0) {
    const parts: string[] = [];
    if (invalidEntities.length > 0) {
      parts.push(`unknown entities: ${invalidEntities.join(", ")}`);
    }
    if (invalidEdges.length > 0) {
      parts.push(`unknown edges: ${invalidEdges.join(", ")}`);
    }
    return {
      kind: "incompatible",
      message: `Schedule references ${parts.join("; ")}.`,
      invalidEntities,
      invalidEdges,
    };
  }

  return { kind: "none" };
}

export function extractEntityIds(scenarioData: Record<string, unknown> | null): string[] {
  return (
    ((scenarioData?.entities as Array<{ id?: string }>) ?? [])
      .map((e) => e.id)
      .filter(Boolean) as string[]
  );
}

export function extractEdgeIds(scenarioData: Record<string, unknown> | null): string[] {
  return (
    ((scenarioData?.topology as { edges?: Array<{ id?: string }> })?.edges ?? [])
      .map((e) => e.id)
      .filter(Boolean) as string[]
  );
}
