# FUEL_FLOW_ARCHITECTURE.md - v9

**Project:** Nuclear Fuel Handling Workflow Optimiser for Multi-Unit SMR Plants  
**Status:** Architecture definition with v1 delivery profile locked  
**Schema version of this document's config examples:** 4

**Changes from v8 (scope lock and UI integration):**
- Locked a concrete v1 delivery profile for kernel and UI workbench.
- Promoted `Scenario.fork()` from deferred to required in v1 due to replanning workflow.
- Locked representative-plant baseline for v1: 3+ units, full shared-resource graph, and boundary flows.
- Locked v1 objective scope: full weighted multi-term scoring with adapter parity checks.
- Locked v1 UX/API surface: local React workbench + localhost Python API (FastAPI), library + CLI.
- Locked v1 editing model: scenario parameter and schedule editing with timeline playback and YAML persistence.
- Clarified v1 deferrals (operational service contracts, custom constraint sandbox, and hosted concerns).

---

## 1. Scope and relationship to v8

This revision keeps v8 architectural semantics as the baseline and adds a normative **v1 delivery profile**.  
Unless explicitly overridden here, requirements from `FUEL_FLOW_ARCHITECTURE_v8.md` remain in force.

Primary addition in v9: a complete end-to-end boundary for what must ship in v1 versus what is deferred.

---

## 2. v1 Delivery Profile (normative)

### 2.1 Kernel and simulation scope

v1 MUST ship:
- representative multi-unit modeling (3+ units),
- shared resources including `fhm`, `corridor_transit`, `crew`, and `cask`,
- full boundary flows (`entity_created` ingress and `entity_departed` egress),
- equal-time phase semantics and deterministic tie-break behavior,
- both hard-violation runtime modes: `fail_fast` and `continue_and_report`,
- closed built-in constraint vocabulary (`capacity`, `thermal`, `temporal`, `resource`, `precedence`, `regulatory`),
- pluggable `DecayModel` with tabulated core exit-state inputs.

### 2.2 Scenario and replanning semantics

v1 MUST include `Scenario.fork()` with:
- event-boundary legality checks,
- equal-time phase completion boundary semantics,
- amendment replay consistency checks,
- rejection of ambiguous same-boundary amendments without explicit precedence metadata.

This supersedes any earlier v1 interpretation that omitted forking.

### 2.3 Optimizer and objective scope

v1 MUST include:
- one minimal optimizer adapter that can produce admissible schedules or structured `infeasible_or_timeout`,
- full objective layer with weighted normalized terms,
- objective parity validation where adapter score matches `Objective.score()` within declared tolerance.

v1 optimizer lock contract (runtime-only, opt-in):
- Default optimize execution is **timing-first**: auto-seeds from explicit `seed_schedule_path` or sibling `schedule.yaml`, preserves move structure, optimizes `start_min`.
- Rejects optimize when no valid seed schedule is available (`seed_schedule_required`).
- Response metadata includes `execution_mode: timing_preserve_structure` and `resolved_seed_schedule_path`.
- `lock_mode`: `legacy` (default when lock payload omitted) or `enforced`.
- When `lock_mode=enforced`, `structure_mode` MUST be `locked` or `unlocked` (timing-first still preserves move set in v1).
- Constraint parameter locks use an EFA × constraint matrix (`constraint_param_locks`): rows are fuel entities plus arrivals and a `__global__` row; columns are scenario constraints; checked cells mean tuning is locked.
- Sparse matrix payloads omit applicable pairs that default to locked; unlocking any applicable row (or Global) makes shared constraint parameters tunable globally.
- Backend resolves effective locks authoritatively; `GET /runs/optimize/capabilities` and `POST /runs/optimize/locks/effective` use saved scenario/schedule paths.
- Solver-encoded unlocks in v1 phase 2a: `temporal` bounds, `resource.max_concurrent`, and hard node `capacity.max_entities` (locked baseline in timing-first mode); `thermal` and `regulatory` unlocks emit warnings; `precedence` is locked-only.
- Timing-first mode preserves canonical per-EFA move sequence (all seed moves mandatory; order fixed; timing-only optimization).
- Per-move field locks (`start_min`) remain supported for structure-locked runs.
- Scenario lock paths are allowlisted (`horizon_min` in v1) and preview-only unless backend reports active scenario tuning.
- Lock contract status is returned in optimize responses and run artifacts (`optimizer.lock_contract`).

### 2.4 Determinism and conformance scope

v1 determinism conformance is:
- byte-identical replay on the same build/flag/platform tuple,
- canonical scenario/schedule digests and deterministic metadata in artifacts,
- deterministic fairness behavior under persistent contention.

Cross-platform byte-identical guarantees remain an open future decision.

### 2.5 Performance scope

v1 MUST provide benchmark instrumentation and reportability, including:
- scenario identifier,
- horizon length,
- hardware/build profile,
- runtime mode and determinism flags.

In v1, benchmark reporting is required; hard release blocking on throughput target is deferred.

### 2.6 Artifact and persistence scope

v1 MUST emit local artifact bundles per run (including `run_manifest.json`, timeline, violations, and metadata).  
v1 UI and API edits MUST persist scenario/schedule amendments to local YAML files.

---

## 3. v1 Planning Workbench profile (normative)

### 3.1 Product role

v1 UI is a planning workbench, not a read-only report viewer.

v1 workbench MUST support:
- adjusting scenario parameters,
- editing schedules,
- fork-from-history replanning,
- triggering simulator and optimizer runs,
- inspecting score, violations, and timeline behavior.

### 3.2 Topology editing boundary

v1 UI MUST treat topology graph structure as file-defined input (loaded from scenario files).  
v1 UI MAY expose topology parameters for inspection/tuning where represented in scenario config, but MUST NOT require an interactive graph authoring tool in v1.

### 3.3 Visualization and interaction model

v1 workbench MUST provide:
- topology-oriented visualization with timeline playback/scrubbing,
- linked schedule table and Gantt views,
- feedback loops suitable for iterative "adjust -> run -> inspect -> adjust."

### 3.4 Runtime architecture

v1 delivery architecture is local-first:
- frontend: React web app,
- backend: localhost Python API (FastAPI) wrapping kernel interfaces,
- invocation surfaces: both library API and CLI remain supported.

Auth, multi-user tenancy, and hosted deployment are out of v1 scope.

---

## 4. Explicit v1 deferrals

The following are architecture-valid but deferred beyond v1:
- custom constraint execution sandbox and allowlisted package runtime (`custom` implementation path),
- idempotency-window enforcement and archival retention operations in a persistent run service,
- checkpoint/crash-recovery execution profile as a required v1 gate,
- mixed-version request routing and profile-affinity fleet behavior,
- interactive topology graph authoring in UI,
- full geometry-driven visual rendering requirements,
- fork lineage browser and rich scenario version-history UX,
- production-grade optimizer strategy selection and tuning,
- cross-platform byte-identical determinism conformance requirement,
- hosted deployment concerns (authz/authn, tenancy, remote persistence).

---

## 5. Open decisions after v1 scope lock

1. Solver strategy for production adapter(s) (CP-SAT vs MILP vs metaheuristics or hybrid).
2. Stochastic extension scope and fault taxonomy.
3. Criteria and migration path for promoting repeated custom patterns into closed vocabulary.
4. Whether unit mode windows become optimizer decision variables in v2+.
5. Checkpoint cadence and operational policy for long-horizon service deployments.
6. Whether cross-platform determinism can graduate to byte-identical guarantees.
7. Hosted deployment model and security envelope for non-local operation.

---

## 6. Version history (appendix)

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
| v9 | Scope lock + UI integration | Locked v1 kernel/UI delivery profile, restored v1 forking requirement, defined local planning workbench boundary and deferrals |
