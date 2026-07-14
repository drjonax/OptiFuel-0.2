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

export type RunResult = {
  manifest?: Record<string, unknown>;
  timeline?: Array<Record<string, unknown>>;
  violations?: Array<Record<string, unknown>>;
  objective?: { total: number; terms: Array<Record<string, unknown>> };
  outcome?: "feasible" | "infeasible_or_timeout";
  reason?: "infeasible" | "timeout" | null;
  score_total?: number | null;
  schedule?: { moves?: Array<Record<string, unknown>> };
  artifacts?: RunResult;
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

export async function optimize(scenarioPath: string, seedSchedulePath: string) {
  return request<RunResult>("/runs/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenario_path: scenarioPath,
      seed_schedule_path: seedSchedulePath,
      seed: 42,
      time_limit_sec: 3,
    }),
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
