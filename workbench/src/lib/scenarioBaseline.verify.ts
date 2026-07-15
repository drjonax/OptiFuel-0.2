/**
 * Lightweight runtime checks for scenario baseline helpers.
 * Run with: npx tsx workbench/src/lib/scenarioBaseline.verify.ts
 */
import { edgeUnitFromId } from "./scenarioHelpers";
import {
  applyGlobalParameter,
  deriveStartingConditions,
  updateEntityHomeUnit,
} from "./scenarioBaseline";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const baseScenario: Record<string, unknown> = {
  schema_version: 4,
  id: "baseline_test",
  horizon_min: 1440,
  topology: {
    nodes: [
      { id: "fresh_store", type: "fresh_store", unit: "shared" },
      { id: "core_u1", type: "core", unit: "U1" },
      { id: "core_u2", type: "core", unit: "U2" },
      { id: "core_u10", type: "core", unit: "U10" },
    ],
    edges: [
      { id: "fresh_to_staging", duration_min: { base_min: 30 } },
      { id: "staging_to_core_u1", duration_min: { base_min: 45 } },
      { id: "staging_to_core_u2", duration_min: { base_min: 45 } },
      { id: "staging_to_core_u10", duration_min: { base_min: 45 } },
      { id: "pool_u10_to_lts", duration_min: { base_min: 120 } },
    ],
  },
  entities: [
    { id: "A1", home_unit: "U1", state: { heat_kw: 1.5 } },
    { id: "A2", home_unit: "U1", state: { heat_kw: 1.5 } },
    { id: "A3", state: { heat_kw: 1.5 } },
  ],
  resources: [{ id: "fhm_1", type: "fhm", capacity: 1 }],
  unit_modes: [
    { unit: "U1", windows: [{ from: 0, to: 1440, mode: "refueling" }] },
    { unit: "U2", windows: [{ from: 0, to: 1440, mode: "refueling" }] },
    { unit: "U10", windows: [{ from: 0, to: 1440, mode: "refueling" }] },
  ],
  constraints: [
    { id: "resource_fhm", type: "resource", params: { max_concurrent: 1 } },
    { id: "cap_staging", type: "capacity", params: { max_entities: 1 } },
  ],
};

const schedule: Record<string, unknown> = {
  schema_version: 4,
  scenario: "baseline_test",
  moves: [
    { entity: "A2", edge: "staging_to_core_u2", start: 100 },
    { entity: "A3", edge: "fresh_to_staging", start: 0 },
  ],
};

const rows = deriveStartingConditions(baseScenario, schedule);
assert(rows.find((row) => row.entityId === "A1")?.unitId === "U1", "A1 uses home_unit");
assert(rows.find((row) => row.entityId === "A2")?.unitId === "U1", "A2 uses home_unit not schedule");
assert(rows.find((row) => row.entityId === "A3")?.unitId === "—", "A3 without home_unit stays unassigned");

assert(edgeUnitFromId("pool_u10_to_lts", ["U1", "U10", "U2"]) === "U10", "u10 beats u1 suffix match");
assert(edgeUnitFromId("staging_to_core_u1", ["U1", "U10", "U2"]) === "U1", "u1 exact match");

const blocked = updateEntityHomeUnit(baseScenario, schedule, "A2", "U1");
assert(!blocked.ok, "home_unit change blocked when schedule has other-unit edge");

const allowed = updateEntityHomeUnit(baseScenario, { moves: [{ entity: "A3", edge: "fresh_to_staging", start: 0 }] }, "A3", "U2");
assert(allowed.ok, "fresh_to_staging only moves should not block reassignment");
if (allowed.ok) {
  const entity = (allowed.scenario.entities as Array<{ id: string; home_unit?: string }>).find((e) => e.id === "A3");
  assert(entity?.home_unit === "U2", "home_unit patched on success");
}

const badCount = applyGlobalParameter(baseScenario, "fhmCount", 0);
assert(!badCount.ok, "fhmCount 0 should fail");

console.log("scenarioBaseline verification passed");
