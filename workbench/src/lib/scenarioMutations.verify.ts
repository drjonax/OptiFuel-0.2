/**
 * Lightweight runtime checks for scenario mutation helpers.
 * Run with: npx tsx workbench/src/lib/scenarioMutations.verify.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addEfa, addUnitScaffold } from "./scenarioMutations";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function snapshot(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const VENV_PYTHON = join(ROOT, ".venv/bin/python3");

function loadReferenceScenario(): Record<string, unknown> {
  const scenarioPath = join(ROOT, "examples/reference_plant/scenario.yaml");
  const json = execSync(
    `${VENV_PYTHON} -c "import yaml, json, sys; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "${scenarioPath}"`,
    { encoding: "utf8" },
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function minimalScenario(): Record<string, unknown> {
  return {
    schema_version: 4,
    id: "minimal",
    horizon_min: 1000,
    topology: {
      nodes: [
        { id: "fresh_store", type: "fresh_store", unit: "shared", boundary: "source" },
        { id: "corridor_staging", type: "corridor_staging", unit: "shared", boundary: "none" },
        { id: "core_u1", type: "core", unit: "U1", boundary: "none" },
        { id: "pool_u1", type: "interim_pool", unit: "U1", boundary: "none" },
      ],
      edges: [],
    },
    entities: [{ id: "A1", location: "fresh_store", state: { heat_kw: 1 }, history: [] }],
    resources: [
      { id: "machine_alpha", type: "fhm", capacity: 1, shared_by: ["U1"], holds_entities: false },
      { id: "team_alpha", type: "crew", capacity: 1, shared_by: ["U1"], holds_entities: false },
      {
        id: "corridor_main",
        type: "corridor_transit",
        capacity: 1,
        shared_by: ["U1"],
        holds_entities: false,
      },
      { id: "cask_alpha", type: "cask", capacity: 1, shared_by: ["U1"], holds_entities: false },
    ],
    unit_modes: [{ unit: "U1", windows: [{ from: 0, to: 1000, mode: "refueling" }] }],
    constraints: [],
    physics: { decay_models: [], core_exit_states: [] },
    arrivals: [],
    departures: [],
    objective: { terms: [] },
  };
}

// --- addEfa tests ---
const reference = loadReferenceScenario();
const efaOnce = addEfa(reference);
assert(efaOnce.ok, "addEfa on reference scenario should succeed");
if (efaOnce.ok) {
  const entities = (efaOnce.scenario.entities as Array<{ id: string }>) ?? [];
  assert(entities.some((entity) => entity.id === "A5"), "expected next entity A5");
  const physics = efaOnce.scenario.physics as {
    decay_models: Array<{ entity_id: string }>;
    core_exit_states: Array<{ entity_id: string }>;
  };
  assert(
    physics.decay_models.some((model) => model.entity_id === "A5"),
    "expected decay model for A5",
  );
  assert(
    physics.core_exit_states.some((state) => state.entity_id === "A5"),
    "expected core exit state for A5",
  );
}

const efaTwice = addEfa(efaOnce.ok ? efaOnce.scenario : reference);
assert(efaTwice.ok, "second addEfa should succeed");
if (efaTwice.ok) {
  const ids = ((efaTwice.scenario.entities as Array<{ id: string }>) ?? []).map((entity) => entity.id);
  assert(ids.filter((id) => id === "A6").length === 1, "expected single A6 entity");
}

// --- addUnit tests on reference ---
const unitOnce = addUnitScaffold(reference);
assert(unitOnce.ok, "addUnitScaffold on reference should succeed");
if (unitOnce.ok) {
  const nodes = (unitOnce.scenario.topology as { nodes: Array<{ id: string }> }).nodes;
  assert(nodes.some((node) => node.id === "core_u4"), "expected core_u4 node");
  assert(nodes.some((node) => node.id === "pool_u4"), "expected pool_u4 node");

  const edges = (unitOnce.scenario.topology as { edges: Array<{ id: string; requires: string[] }> })
    .edges;
  const stagingEdge = edges.find((edge) => edge.id === "staging_to_core_u4");
  assert(Boolean(stagingEdge), "expected staging_to_core_u4 edge");
  assert(
    stagingEdge!.requires.every((resourceId) =>
      ((unitOnce.scenario.resources as Array<{ id: string }>) ?? []).some(
        (resource) => resource.id === resourceId,
      ),
    ),
    "edge requires must reference existing resources",
  );

  const unitModes = (unitOnce.scenario.unit_modes as Array<{ unit: string }>) ?? [];
  assert(unitModes.some((mode) => mode.unit === "U4"), "expected unit mode for U4");

  const resources = (unitOnce.scenario.resources as Array<{ shared_by?: string[] }>) ?? [];
  assert(
    resources.every((resource) => (resource.shared_by ?? []).includes("U4")),
    "all resources should include U4 in shared_by",
  );
}

const unitTwice = addUnitScaffold(unitOnce.ok ? unitOnce.scenario : reference);
assert(unitTwice.ok, "second addUnitScaffold should succeed");
if (unitTwice.ok) {
  const nodeIds = ((unitTwice.scenario.topology as { nodes: Array<{ id: string }> }).nodes ?? []).map(
    (node) => node.id,
  );
  assert(nodeIds.filter((id) => id === "core_u5").length === 1, "expected single core_u5");
}

// --- non-standard resource IDs ---
const minimal = minimalScenario();
const minimalUnit = addUnitScaffold(minimal);
assert(minimalUnit.ok, "addUnitScaffold with non-standard resource IDs should succeed");
if (minimalUnit.ok) {
  const edges = (minimalUnit.scenario.topology as { edges: Array<{ requires: string[] }> }).edges;
  const requires = edges.flatMap((edge) => edge.requires);
  assert(requires.includes("machine_alpha"), "should resolve fhm by type, not hardcoded id");
  assert(requires.includes("team_alpha"), "should resolve crew by type");
  assert(requires.includes("corridor_main"), "should resolve corridor_transit by type");
  assert(requires.includes("cask_alpha"), "should resolve cask by type");
}

// --- missing resource class fails atomically ---
const broken = minimalScenario();
broken.resources = (broken.resources as Array<{ id: string; type: string }>).filter(
  (resource) => resource.type !== "cask",
);
const beforeBroken = snapshot(broken);
const brokenResult = addUnitScaffold(broken);
assert(!brokenResult.ok, "missing cask should fail");
assert(snapshot(broken) === beforeBroken, "failed mutation must not mutate input scenario");

// --- backend validate smoke ---
if (unitTwice.ok && efaTwice.ok) {
  let combined = efaTwice.scenario;
  const extraUnit = addUnitScaffold(combined);
  assert(extraUnit.ok, "combined mutation should succeed");
  if (extraUnit.ok) {
    combined = extraUnit.scenario;
    const tempDir = mkdtempSync(join(ROOT, ".tmp-scenario-mutation-"));
    const tempPath = join(tempDir, "scenario.yaml");
    try {
      execSync(
        `${VENV_PYTHON} -c "import yaml, json, sys; yaml.safe_dump(json.loads(sys.stdin.read()), open('${tempPath}', 'w'), sort_keys=False)"`,
        { input: JSON.stringify(combined), encoding: "utf8", cwd: ROOT },
      );
      execSync(`${join(ROOT, ".venv/bin/optifuel")} validate "${tempPath}"`, { cwd: ROOT, stdio: "pipe" });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

console.log("scenarioMutations verification passed");
