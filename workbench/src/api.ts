const API_BASE = "/api";

export type ScenarioResponse = {
  data: Record<string, unknown>;
  digest: string;
  etag: string;
};

export type ViolationRecord = {
  constraint_id: string;
  rule_id?: string;
  target?: string;
  scope?: string;
  hard: boolean;
  message: string;
  entity_ids: string[];
  t_min?: number | null;
};

export type ScheduleMoveRecord = {
  entity: string;
  edge: string;
  start: number;
};

export type MoveLockRecord = {
  entity: string;
  edge: string;
  occurrence_index?: number;
  locked_fields?: Array<"start_min">;
};

export type ConstraintParamLockRecord = {
  entity_id: string;
  constraint_id: string;
  locked: boolean;
};

export type OptimizeLockMode = "legacy" | "enforced";
export type StructureLockMode = "locked" | "unlocked";

export type OptimizeLockOptions = {
  lock_mode: OptimizeLockMode;
  structure_mode?: StructureLockMode;
  move_locks?: MoveLockRecord[];
  scenario_locks?: string[];
  constraint_param_locks?: ConstraintParamLockRecord[];
};

export type LockCapabilities = {
  scenario_tunable_active: boolean;
  allowlisted_scenario_paths: string[];
  move_fields: string[];
  global_entity_id?: string;
};

export type MatrixConstraintInfo = {
  id: string;
  type: string;
  scope: string;
  target: string;
};

export type MatrixLockCapabilities = LockCapabilities & {
  entities: string[];
  constraints: MatrixConstraintInfo[];
  applicability: Record<string, Record<string, boolean>>;
  tunable_params_by_constraint: Record<string, string[]>;
  shared_constraint_ids: string[];
  locked_only_constraint_ids: string[];
  solver_encoded_constraint_ids: string[];
  solver_encoded_types?: string[];
  locked_only_types?: string[];
};

export type LockEffectivePreview = {
  effective_constraint_locks: Record<string, boolean>;
  unlock_warnings: string[];
  shared_unlocked_constraint_ids: string[];
};

export type RunResult = {
  manifest?: Record<string, unknown>;
  timeline?: Array<Record<string, unknown>>;
  violations?: Array<Record<string, unknown>>;
  objective?: { total: number; terms: Array<Record<string, unknown>> };
  outcome?: "feasible" | "infeasible_or_timeout";
  reason?: "infeasible" | "timeout" | "structure_violation" | null;
  score_total?: number | null;
  schedule?: { moves?: Array<Record<string, unknown>> };
  artifacts?: RunResult;
  execution_mode?: string;
  resolved_seed_schedule_path?: string;
  lock_contract?: {
    lock_mode?: OptimizeLockMode;
    structure_mode?: StructureLockMode;
    active?: boolean;
    warning?: string;
    effective?: LockEffectivePreview & {
      tuned_constraint_params?: Record<string, Record<string, number>>;
    };
  };
  lock_capabilities?: MatrixLockCapabilities;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.detail?.message ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listScenarios(): Promise<string[]> {
  return request<string[]>("/scenarios");
}

export async function getScenario(path: string): Promise<ScenarioResponse> {
  return request<ScenarioResponse>(`/scenarios/${path}`);
}

export async function saveScenario(path: string, data: Record<string, unknown>, etag?: string) {
  return request<{ digest: string; etag: string }>(`/scenarios/${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: JSON.stringify({ data, if_match: etag }),
  });
}

export async function getSchedule(path: string): Promise<ScenarioResponse> {
  return request<ScenarioResponse>(`/schedules/${path}`);
}

export async function saveSchedule(path: string, data: Record<string, unknown>, etag?: string) {
  return request<{ digest: string; etag: string }>(`/schedules/${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: JSON.stringify({ data, if_match: etag }),
  });
}

export async function simulate(scenarioPath: string, schedulePath: string, runtimeMode: string) {
  return request<RunResult>("/runs/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario_path: scenarioPath,
      schedule_path: schedulePath,
      runtime_mode: runtimeMode,
    }),
  });
}

export async function getOptimizeCapabilities(
  scenarioPath?: string,
  schedulePath?: string,
): Promise<MatrixLockCapabilities> {
  const params = new URLSearchParams();
  if (scenarioPath) params.set("scenario_path", scenarioPath);
  if (schedulePath) params.set("schedule_path", schedulePath);
  const query = params.toString();
  return request<MatrixLockCapabilities>(
    `/runs/optimize/capabilities${query ? `?${query}` : ""}`,
  );
}

export async function postLockEffective(payload: {
  scenario_path: string;
  schedule_path?: string;
  lock_mode: OptimizeLockMode;
  structure_mode?: StructureLockMode;
  constraint_param_locks?: ConstraintParamLockRecord[];
}): Promise<LockEffectivePreview> {
  return request<LockEffectivePreview>("/runs/optimize/locks/effective", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function optimize(
  scenarioPath: string,
  seedSchedulePath: string,
  lockOptions?: OptimizeLockOptions,
) {
  const body: Record<string, unknown> = {
    scenario_path: scenarioPath,
    seed_schedule_path: seedSchedulePath,
    seed: 42,
    time_limit_sec: 3,
  };
  if (lockOptions) {
    body.lock_mode = lockOptions.lock_mode;
    if (lockOptions.structure_mode) body.structure_mode = lockOptions.structure_mode;
    if (lockOptions.move_locks?.length) body.move_locks = lockOptions.move_locks;
    if (lockOptions.scenario_locks?.length) body.scenario_locks = lockOptions.scenario_locks;
    if (lockOptions.constraint_param_locks?.length) {
      body.constraint_param_locks = lockOptions.constraint_param_locks;
    }
  }
  return request<RunResult>("/runs/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function forkScenario(payload: {
  scenario_path: string;
  schedule_path: string;
  state_at_min: number;
  amendments: Record<string, unknown>;
  precedence?: string;
}) {
  return request<{ scenario_id: string; path: string; digest: string }>("/scenarios/fork", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
