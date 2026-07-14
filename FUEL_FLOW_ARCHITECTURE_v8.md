# FUEL_FLOW_ARCHITECTURE.md — v8

**Project:** Nuclear Fuel Handling Workflow Optimiser for Multi-Unit SMR Plants  
**Status:** Architecture definition; simulator-first implementation track  
**Schema version of this document's config examples:** 4

**Changes from v7 (third stress-test hardening):**
- Added idempotency/retry contract for run execution and replay.
- Added crash recovery and checkpoint semantics for long simulations.
- Added log safety and sensitive-data redaction contract.
- Added migration/release gates for rule lifecycle changes.
- Added stricter conformance requirements for floating-point stability.
- Added fault-injection expectations for recovery and partial-failure behavior.

---

## 1. Problem Statement

Fuel assemblies flow through a directed graph of plant locations:

```text
FreshStore -> [staging?] -> Core [years] -> InterimPool(unit) -> [staging?] -> LongTermStorage
```

FHMs and corridor transit rights are resources consumed by moves, not resting locations. Corridor staging areas are nodes.

- Multiple units share corridor transit, FHMs, crews, and long-term storage.
- Constraints apply to nodes, edges, resources, and timeline state.
- Fuel heat is time-dependent and derived from state functions.
- Source/sink boundary flows model arrivals and departures.
- Modeling and scheduling granularity is the individual fuel assembly.

Formal class: resource-constrained project scheduling over a flow network with time-dependent entity state and boundary flows.

### 1.1 Scope boundary: core as black box

Loading-pattern optimization is out of scope.

`exit_state(entity, cycle) -> {burnup_mwd_kgu, discharge_time}` is Scenario input, not a decision variable.

In scope:
- move timing and sequencing,
- resource contention handling,
- feasibility and objective scoring.

Out of scope:
- loading-pattern/shuffle optimization,
- burnup optimization beyond configured exit-state inputs.

---

## 2. Normative Terms and Compatibility

This document uses:
- **MUST** for mandatory behavior,
- **SHOULD** for expected behavior with justified exceptions,
- **MAY** for optional behavior.

Compatibility policy:
- Architecture version and config `schema_version` are independent.
- Architecture revisions do not imply schema major bumps.
- Schema major bump is required only for backward-incompatible config contract changes.

---

## 3. Layer Overview

| # | Layer | Responsibility | Knows about |
|---|---|---|---|
| 1 | Topology | Legal rest-state graph and source/sink structure | Nothing above it |
| 2 | Entity | Assembly identity, history, state functions | Topology |
| 3 | Physics | Decay and core exit-state functions | Entity attributes |
| 4 | Constraint | Closed declarative rule vocabulary | Topology, Entity, Physics |
| 5 | Resource | FHMs, corridor transit, crews, calendars, unit modes | Topology |
| 6 | Scenario | Immutable validated problem instance and forks | Layers 1-5 |
| 7 | Objective | Normalized weighted scoring | Scenario, Schedule |
| 8 | Engine | Deterministic simulation and optimizer adapters | All via Scenario |

Dependency rule:
- Imports flow downward only.
- `engine/opt` may depend on `engine/sim`; reverse dependency is forbidden.

---

## 4. Layer Specifications

### 4.1 Topology

Nodes are legal rest states.

- `corridor_staging` is a node.
- `corridor_transit` is a resource.
- Bare `corridor` type is forbidden.

```yaml
node:
  id: string
  type: fresh_store | corridor_staging | core | interim_pool | lts
  unit: string | shared
  boundary: none | source | sink
  geometry:
    positions:
      - {id: int, coord_mm: [x, y]}
  attributes: {}
```

```yaml
edge:
  id: string
  from: node_id
  to: node_id
  requires: [resource_id]
  duration_min:
    base: number
    modifiers: [modifier]
```

### 4.2 Entity

Every entity is one assembly; no batch/composite construct exists.

```yaml
entity:
  id: string
  location: node_id | resource_id
  position: int | null
  history: [event]
  state:
    burnup_mwd_kgu: float
    discharge_time: sim_time | null
    heat: fn(t) -> kW
```

`location: resource_id` is legal only when the resource has `holds_entities: true`.

### 4.3 Event vocabulary and deterministic semantics

```yaml
event:
  t: sim_time
  entity: entity_id
  kind: move_started | move_completed | move_aborted |
        dwell_started | entity_created | entity_departed |
        state_exception_entered | state_exception_cleared |
        constraint_violated
  edge: edge_id | null
  detail: {}
```

#### 4.3.1 Equal-time phase model

For each timestamp `t`, simulation MUST execute all phases before advancing:

1. ingress: `entity_created`, external arrivals
2. completion: `move_completed`, `state_exception_cleared`
3. state: `dwell_started`, derived state updates
4. allocation: evaluate/start eligible moves (`move_started`)
5. egress: `entity_departed`
6. validation: emit `constraint_violated`

Within each phase, ties resolve by:
1) `entity_id`, then 2) `edge_id` (if present), then 3) stable insertion order.

No event from a later phase at time `t` may execute before all earlier phases at `t` complete.

#### 4.3.2 Fairness under persistent contention

If equal-priority move candidates repeatedly contend for a saturated resource, engine SHOULD use deterministic round-robin fairness keyed by `(resource_id, contender_set_signature)`.

If strict lexicographic tie-break is retained instead, this MUST be documented as starvation-allowed and validated in scenario acceptance criteria.

#### 4.3.3 Hard-violation policy

Engine runtime mode MUST be explicit:
- `fail_fast`: stop execution at first hard violation.
- `continue_and_report`: continue, but hard violations remain failing outcomes.

Default for CI and optimizer acceptance tests: `fail_fast`.

#### 4.3.4 Idempotency and retry semantics (new)

A run request MUST include a caller-supplied `idempotency_key` (or engine-generated equivalent persisted in metadata). Re-submitting the same `(scenario_digest, schedule_digest, engine_digest, idempotency_key)` MUST return the same run identity and artifact bundle, not create a second logical run.

Retries after transport/process failure MUST be safe and deterministic.

### 4.4 Physics

```text
DecayModel.heat(entity, t) -> kW
CoreExitModel.exit_state(entity, cycle) -> {burnup_mwd_kgu, discharge_time}
```

Decay models declare monotonicity between state-changing events.

### 4.5 Constraint

```yaml
constraint:
  id: string
  scope: node | edge | resource | path | global
  target: element_id
  type: capacity | thermal | temporal | resource | precedence | regulatory | custom
  predicate: <closed expression vocabulary>
  hard: bool
  params: {}
```

`custom` remains debt-tracked and must be listed in `CONSTRAINT_DEBT.md` with migration intent.

#### 4.5.1 Custom extension boundary

Any `custom` implementation reference MUST resolve only to a registered, signed, allowlisted package.

Custom implementations MUST NOT:
- execute network calls during predicate evaluation,
- read/write filesystem outside configured temp/output locations,
- mutate scenario or simulator state.

Custom execution failures MUST be deterministic error outcomes, never silent passes.

### 4.6 Resource and calendars

```yaml
resource:
  id: string
  type: fhm | corridor_transit | crew | cask | other
  capacity: int
  calendar: [window]
  shared_by: [unit_id]
  holds_entities: bool
```

```yaml
unit_mode:
  unit: U2
  windows: [{from: sim_time, to: sim_time, mode: power | shutdown | refueling}]
```

Calendar semantics:
- windows are half-open intervals `[from, to)`,
- overlap is forbidden unless precedence resolver is configured,
- gap behavior MUST be explicit (`unavailable` or inherited mode),
- precedence resolution MUST be deterministic and versioned.

---

## 5. Scenario, Schedule, and Engine Contract

```text
Scenario = Topology + Entities(t_start) + Arrival schedule + Physics bindings
         + Constraints + Resources + Unit modes + Horizon + Objective config
```

Scenario is immutable after validation.

Forking:

```text
Scenario.fork(state_at: sim_time | executed_history, amendments: {…}) -> Scenario'
```

Forks are legal only at event boundaries. At equal-time boundaries, snapshots occur only after full phase completion.

Schedule:

```yaml
schedule:
  schema_version: 4
  scenario: scenario_id
  moves:
    - {entity: entity_id, edge: edge_id, start: sim_time}
```

Engine derives internal stable move identity:
`move_key = hash(entity, edge, start, ordinal_for_same_tuple)`.

### 5.1 Reproducibility contract

For deterministic runs, engine MUST persist:
- canonical scenario digest,
- canonical schedule digest,
- engine build/version digest,
- deterministic-mode flags (including fairness policy),
- floating-point mode/tolerance profile.

Canonical digests MUST use a defined canonical serialization (stable key order, UTF-8, newline policy).

### 5.2 Checkpoint and crash-recovery contract (new)

Long-running simulation MAY checkpoint. If enabled:
- checkpoint boundaries MUST align to completed timestamp phase pipelines,
- resumed execution from checkpoint MUST produce byte-identical outputs to uninterrupted execution,
- checkpoint metadata MUST include parent run identity and deterministic flags.

### 5.3 Run artifact contract and log safety (new)

Each run MUST emit an artifact bundle with:
- `run_manifest.json`,
- canonical input digests and full run metadata,
- timeline output,
- violation list,
- deterministic configuration profile,
- optional checkpoint chain metadata.

Artifacts MUST redact sensitive fields according to an allowlist logging policy (deny-by-default for free-text custom payloads).

Simulator MUST:
- process arrivals/departures,
- apply equal-time phase semantics,
- evaluate constraints at events and injected points,
- emit timeline, violations, and run metadata.

Optimizer adapters MUST emit schedules that pass simulator with zero hard violations.

---

## 6. Objective Layer

```yaml
objective:
  terms:
    - {metric: outage_duration_h, weight: 0.5, normalise: {ref: 720}}
    - {metric: peak_storage_heat_kw, weight: 0.3, normalise: {range: [0, 2000]}}
    - {metric: handling_ops_count, weight: 0.2, normalise: {ref: 100}}
```

Rules:
- every term MUST declare normalization,
- time-dependent terms MUST satisfy the same time-soundness gate as constraints,
- adapter-native objective shortcuts MUST match `Objective.score()` on golden scenarios.

### 6.1 Objective parity tolerance

Parity checks MUST declare:
- absolute tolerance,
- relative tolerance,
- deterministic tie-breaking for near-equal candidates.

If parity exceeds tolerance, adapter score is invalid regardless of optimization gain.

### 6.2 Numeric stability policy (new)

Floating-point accumulation order MUST be deterministic. Where platform drift is possible, either:
- use fixed reduction order with compensated summation, or
- use deterministic decimal/fixed-point representation for declared critical metrics.

Critical metrics list MUST be versioned in validation metadata.

---

## 7. Conventions

### 7.1 Units

Numeric fields and parameters use suffixes (`_kw`, `_mwd_kgu`, `_min`, `_h`, `_mm`).

### 7.2 Schema versioning

Every config artifact includes `schema_version: int`.

### 7.3 Time

Kernel time is simulation-relative minutes; date/timezone mapping is IO-only.

---

## 8. Validation Registry and Severity

Stable IDs are never renumbered; retired IDs remain reserved.

| ID | Rule |
|---|---|
| V-01 | `schema_version` present and supported |
| V-02 | Closed node/resource enums; bare `corridor` banned |
| V-03 | All references resolve |
| V-04 | Numeric parameters carry unit suffixes |
| V-05 | Graph connectivity and source reachability checks |
| V-06 | Edge/path-template consistency or explicit alternate-route flags |
| V-07 | Geometry required where geometric constraints target |
| V-08 | Retired in v4 (batch/member exclusivity) |
| V-09 | Retired in v4 (batch/geometric exclusion) |
| V-10 | Time-soundness: monotonicity or declared evaluation points |
| V-11 | Resource locations allowed only for `holds_entities: true` |
| V-12 | Fork amendments consistent with replayed history |
| V-13 | Engine enforces equal-time phase semantics |
| V-14 | Calendar overlap/gap handling is explicit and valid |
| V-15 | Run metadata includes reproducibility contract fields |
| V-16 | Custom constraints resolve to allowlisted implementations |
| V-17 | Idempotency key behavior is deterministic for identical run inputs |
| V-18 | Artifact/log redaction policy is applied and test-verified |
| V-19 | Checkpoint resume parity equals uninterrupted run output |

Severity policy:
- `error`: scenario/run contract rejected.
- `warning`: accepted, but warnings MUST be attached to run metadata.

Rules affecting feasibility, determinism, security, or replay integrity MUST be `error`.

### 8.1 Deprecation lifecycle

Rule and field lifecycle states:
- `active`,
- `deprecated` (still accepted with warning),
- `retired` (rejected unless migration shim enabled).

Migration docs MUST map deprecated/retired items to replacements.

### 8.2 Release gating for lifecycle transitions (new)

Any transition to `retired` MUST ship with:
- migration notes,
- automated upgrade check,
- rollback guidance for one prior supported version window.

---

## 9. Non-Functional Requirements

Conforming implementations SHOULD meet:
- **Determinism:** same scenario+schedule+engine build => identical timeline and score.
- **Auditability:** store scenario hash, schedule hash, engine version, validation rule set version, run mode, lineage.
- **Traceability:** every violation cites `rule_id` and affected entity/resource/node IDs.
- **Performance (sim v1):** >= 10,000 move events/min in feasibility mode.
- **Recovery:** checkpoint restore latency target and parity checks are measurable.

Benchmark protocol MUST include:
- dataset/scenario ID,
- horizon length,
- hardware profile ID,
- engine build ID,
- runtime mode,
- determinism/fairness configuration,
- warmup and measurement window length.

---

## 10. Module Layout

```text
fuelflow/
  topology/
  entities/
  physics/
  constraints/
  resources/
  scenario/
    validation/
  objectives/
  engine/
    sim/
    opt/
  io/
tests/
  conformance/
  golden/
  determinism/
  recovery/
  security/
CONSTRAINT_DEBT.md
docs/adr/
```

Boundary rules:
- directional dependencies are tested,
- constraint parsing/evaluation exists only in `constraints`,
- kernel remains date/timezone agnostic,
- grouping remains optimizer-internal.

---

## 11. Verification Strategy

- Golden scenarios include known-feasible and known-infeasible cases.
- Acceptance property: adapter-emitted schedules pass simulator with zero hard violations.
- Objective parity: adapter score equals `Objective.score()` within declared tolerance.
- Determinism tests replay identical inputs N times and assert byte-identical serialization.
- Recovery tests validate checkpoint resume parity.
- Security tests validate custom sandbox boundaries and artifact redaction.
- Retry tests validate idempotency key semantics under repeated submission.

---

## 12. Open Decisions

1. Solver strategy per adapter (CP-SAT vs MILP vs metaheuristics).
2. Stochastic extension scope and fault taxonomy.
3. Constraint-vocabulary growth criteria for repeated custom patterns.
4. Whether unit mode windows become decision variables in v2.
5. Whether starvation-free fairness is mandatory or profile-selectable.
6. Required checkpoint cadence for very long horizons.

---

## 13. Change Control and ADR Policy

Architecture-impacting changes MUST include ADR entries when they:
- alter layer boundaries/dependency direction,
- change schedule/scenario runtime semantics,
- introduce new validation rules or severity shifts,
- modify objective semantics/parity assumptions,
- alter reproducibility, security, recovery, or redaction contracts.

Each architecture revision SHOULD reference related ADR IDs.

---

## 14. Version History

| Version | Driver | Key changes |
|---|---|---|
| v1 | Initial abstraction | Eight layers; simulator-first foundation |
| v2 | Review cycle | Resource-only FHM, closed constraints, fork/replan |
| v3 | Multi-unit hardening | Corridor split, modes/outage, sources/sinks, validation registry |
| v4 | Scope decision | Batch removal, assembly-level schedule contract restored |
| v5 | Hardening pass | Deterministic ordering, severity model, NFRs, ADR policy |
| v6 | Adversarial pass | Phase barriers, hard-violation modes, calendar semantics, benchmark protocol |
| v7 | Second adversarial pass | Reproducibility contract, fairness policy, custom security boundary, deprecation lifecycle |
| v8 | Third adversarial pass | Idempotency/retry contract, recovery checkpoints, redaction policy, release-gated lifecycle transitions |
