# OptiFuel Architecture Report (Codebase-Derived)

## Executive Summary

OptiFuel is implemented as a local-first planning system with a Python backend and a React workbench. The backend exposes both a CLI and a FastAPI HTTP interface over the same service layer, so simulation and optimization behavior is shared regardless of entrypoint (`fuelflow/cli.py`, `fuelflow/api/app.py`, `fuelflow/services.py`).

At runtime, users edit scenario and schedule data in the workbench, trigger simulation or optimization, inspect feasibility/objective/violations, and optionally fork scenarios for replanning. Inputs and outputs are filesystem-based YAML/JSON artifacts under a workspace root, with deterministic digesting and atomic write safeguards (`fuelflow/io/yaml_io.py`, `fuelflow/io/canonical.py`, `fuelflow/io/artifacts.py`, `workbench/src/App.tsx`).

The most important architectural characteristics visible in code are:
- a layered backend (API/CLI adapters -> services -> kernel/domain -> IO),
- deterministic simulation/optimization emphasis (ordered processing + deterministic solver settings),
- explicit lock-contract machinery around optimization,
- a UI orchestrator that keeps local draft state and blocks risky operations until saved.

The biggest practical risks are architectural complexity in optimization lock semantics and the gap between UI algorithm selectors and backend optimizer selection behavior (`workbench/src/components/views/OptimizeView.tsx`, `fuelflow/services.py`, `fuelflow/engine/opt/locks.py`).

## Evidence Basis

This report is based on implementation code in:
- backend/domain: `fuelflow/`
- workbench: `workbench/src/`
- runtime scripts and configuration: `scripts/`, `pyproject.toml`, `workbench/package.json`, `workbench/vite.config.ts`
- verification: `tests/`

No architecture prose docs were used as primary evidence for claims.

## 1) System Overview

The implemented system has two continuously running local processes:
- backend API via `optifuel serve` on `127.0.0.1:8000`,
- workbench Vite dev server on `127.0.0.1:5173`.

`scripts/start.sh` launches both, sets `OPTIFUEL_WORKSPACE`, and handles coordinated shutdown. The workbench routes `/api/*` calls to backend endpoints through Vite proxy rules (`scripts/start.sh`, `workbench/vite.config.ts`).

From a user journey perspective, the core loop is:
1. Load scenario/schedule files.
2. Edit scenario parameters and schedule moves.
3. Run simulation to validate feasibility and inspect timeline effects.
4. Run optimization to retime schedule under lock settings.
5. Optionally apply optimized schedule back to builder state.
6. Optionally fork scenario from a selected simulation boundary.

This loop is visible in `workbench/src/App.tsx` and backed by API methods in `workbench/src/api.ts`.

## 2) Architecture Layers

This section describes the architecture as a layered stack and explains each layer's responsibility and boundary.

### 2.1 Layer A - Presentation Layer (Workbench UI)

**What it does**
- Owns transient editing state, selection state, and view composition.
- Orchestrates user actions (simulate, optimize, fork, save).
- Presents model-aware controls (lock matrix, timeline scrubber, Gantt/topology linking).

**Key modules**
- `workbench/src/App.tsx`
- `workbench/src/components/views/BuilderView.tsx`
- `workbench/src/components/views/SimulateView.tsx`
- `workbench/src/components/views/OptimizeView.tsx`

**Boundary**
- Does not execute simulation or optimization logic.
- Sends typed requests through `workbench/src/api.ts`.

### 2.2 Layer B - Adapter Layer (HTTP API + CLI)

**What it does**
- Translates external input into service calls.
- Validates request envelopes and returns normalized errors.
- Enforces runtime interface contracts (endpoint parameters, command options).

**Key modules**
- HTTP: `fuelflow/api/app.py`
- CLI: `fuelflow/cli.py`

**Boundary**
- Adapters do not implement domain logic directly.
- Both adapters delegate to `fuelflow/services.py`.

### 2.3 Layer C - Application Service Layer

**What it does**
- Coordinates end-to-end use cases:
  - load and validate inputs,
  - execute kernel operations,
  - compute objective,
  - package artifacts,
  - apply run guardrails.
- Acts as the single place where API and CLI behavior converge.

**Key module**
- `fuelflow/services.py`

**Boundary**
- Services orchestrate kernel and IO but do not define core domain types/rules.

### 2.4 Layer D - Domain and Computation Kernel

**What it does**
- Defines domain model and invariants.
- Executes simulation and optimization.
- Implements constraints and objective scoring.
- Implements scenario forking semantics.

**Key modules**
- models: `fuelflow/scenario/model.py`, `fuelflow/topology/models.py`, `fuelflow/entities/models.py`, `fuelflow/resources/models.py`, `fuelflow/physics/decay.py`
- simulation: `fuelflow/engine/sim/simulator.py`
- optimization: `fuelflow/engine/opt/cpsat_adapter.py`, `fuelflow/engine/opt/locks.py`
- constraints and scoring: `fuelflow/constraints/vocabulary.py`, `fuelflow/objectives/scoring.py`
- fork semantics: `fuelflow/scenario/fork.py`

**Boundary**
- Kernel computes in-memory structures and returns structured outputs.
- It relies on IO helpers for persistence and on services for orchestration.

### 2.5 Layer E - Persistence and Determinism Infrastructure

**What it does**
- Safe load/save of YAML model files with path and stale-write protection.
- Canonical serialization and digesting for deterministic artifacts.
- Artifact bundle creation for run outputs.
- Seed path resolution helpers shared across backend/workbench conventions.

**Key modules**
- `fuelflow/io/yaml_io.py`
- `fuelflow/io/canonical.py`
- `fuelflow/io/artifacts.py`
- `fuelflow/io/paths.py`

**Boundary**
- This layer is intentionally storage-mechanism-focused and domain-agnostic.

## 3) Goals and Scope Observed in Code

From implementation behavior, current scope includes:
- local single-user operation with loopback defaults (`scripts/start.sh`, `fuelflow/cli.py`, `fuelflow/api/app.py`)
- scenario/schedule file editing with etag/digest guarded saves (`fuelflow/api/app.py`, `fuelflow/services.py`, `fuelflow/io/yaml_io.py`)
- simulation and optimization run execution with artifact emission (`fuelflow/services.py`, `fuelflow/io/artifacts.py`)
- fork-based replanning (`fuelflow/scenario/fork.py`)

Not present in current code:
- hosted auth/tenancy surface,
- database-backed run management,
- distributed queue/coordinator.

## 4) Component and Module Architecture

### 4.1 Backend components

- `fuelflow/api/app.py`: FastAPI app wiring, request models, endpoint handlers.
- `fuelflow/cli.py`: Typer commands for same core use cases.
- `fuelflow/services.py`: use-case orchestrator and guardrails.
- `fuelflow/__init__.py`: public library API exports.

### 4.2 Kernel components

- domain model family (`scenario`, `topology`, `entities`, `resources`, `physics`),
- validation registry (`fuelflow/scenario/validation.py`),
- simulation engine (`fuelflow/engine/sim/simulator.py`),
- optimization and lock contract (`fuelflow/engine/opt/*.py`),
- objective scoring (`fuelflow/objectives/scoring.py`),
- constraint evaluation (`fuelflow/constraints/vocabulary.py`).

### 4.3 Workbench components

- app orchestrator + data loading/saving (`workbench/src/App.tsx`),
- API client (`workbench/src/api.ts`),
- views:
  - builder (edit/save/fork tools),
  - simulate (run + inspect timeline),
  - optimize (run + lock matrix + delta + apply to builder).

## 5) Data Model and Domain Semantics

### 5.1 Core entities

`Scenario` and `Schedule` are primary persisted structures (`fuelflow/scenario/model.py`):
- Scenario: topology, entities, resources, unit modes, constraints, physics, arrivals/departures, objective, lineage.
- Schedule: ordered move list tied to scenario id.

### 5.2 Constraint semantics

Constraint type set is closed (`capacity`, `thermal`, `temporal`, `resource`, `precedence`, `regulatory`), and violations are emitted as normalized records with hard/soft behavior (`fuelflow/constraints/vocabulary.py`).

### 5.3 Fork semantics

Forking replays simulation timeline, enforces legal boundary times, validates amendment consistency, updates lineage metadata, and validates resulting scenario (`fuelflow/scenario/fork.py`).

## 6) Data Flow

### 6.1 Edit and Save Flow

1. Workbench loads scenario and sibling schedule.
2. User edits in-memory JSON objects.
3. Save sends PUT with optional `If-Match` etag.
4. Backend validates and performs atomic write.
5. Workbench stores returned etag snapshot and clears dirty state.

Sources: `workbench/src/App.tsx`, `workbench/src/api.ts`, `fuelflow/api/app.py`, `fuelflow/services.py`, `fuelflow/io/yaml_io.py`.

### 6.2 Simulation Flow

1. Workbench posts `/runs/simulate`.
2. Service validates scenario/schedule.
3. Simulator computes timeline/violations/metrics.
4. Objective is scored.
5. Artifact bundle and response payload are returned.

Sources: `workbench/src/App.tsx`, `fuelflow/api/app.py`, `fuelflow/services.py`, `fuelflow/engine/sim/simulator.py`, `fuelflow/objectives/scoring.py`, `fuelflow/io/artifacts.py`.

### 6.3 Optimization Flow

1. Workbench posts `/runs/optimize` with seed path and lock options.
2. Service resolves seed path, validates lock contract, computes lock resolution.
3. CP-SAT adapter retimes schedule with structure-preserving behavior.
4. Result is replay-simulated/scored; metadata and artifacts are returned.

Sources: `workbench/src/api.ts`, `fuelflow/api/app.py`, `fuelflow/services.py`, `fuelflow/engine/opt/cpsat_adapter.py`, `fuelflow/engine/opt/locks.py`.

## 7) Control Flow and Runtime Behavior

### 7.1 Simulation control pattern

The simulator constructs event times from arrivals/departures/move bounds, executes a deterministic phase order at each time, and applies runtime mode behavior (`fail_fast` vs `continue_and_report`) when hard violations occur (`fuelflow/engine/sim/simulator.py`).

Admission checks reject move starts when resource calendars block the full move interval, shared resource capacity is exceeded, the same EFA is already active, location continuity fails, or unit refueling mode forbids the move. Multiple concurrent moves in the same unit remain allowed when they do not contend on shared resources/constraints.

Simulation responses now include additive feasibility metadata (`outcome`, `reason`, `infeasible_category`) mapped from hard violations with deterministic category precedence (`fuelflow/engine/sim/feasibility.py`, `fuelflow/services.py`).

### 7.2 Optimization control pattern

Optimization is mediated by services:
- enforce seed schedule existence,
- enforce lock contract validity,
- reject structure signature drift after optimize,
- run post-opt simulation for feasibility and objective consistency.

Source: `fuelflow/services.py`.

### 7.3 UI control pattern

`App.tsx` is the finite-state coordinator for view mode, loading/error state, dirty state, and selected timeline/move linkage. It intentionally blocks optimize when scenario or schedule is unsaved and blocks run actions on mismatch states (`workbench/src/App.tsx`).

## 8) Optimization Pipeline Explained

### 8.1 Inputs and Preconditions

- scenario path,
- seed schedule path (explicit or sibling resolution),
- lock contract options,
- solver seed/time limit.

Source: `fuelflow/api/app.py`, `fuelflow/services.py`, `fuelflow/io/paths.py`.

### 8.2 Lock Contract Stage

`OptimizeLockContract` formalizes lock mode and matrix semantics. Effective lock state is computed from sparse matrix payload and applicability rules. Warnings are produced for unsupported unlock categories. This both constrains optimization and informs UI feedback (`fuelflow/engine/opt/locks.py`).

### 8.3 Model Build and Solve Stage

The CP-SAT adapter:
- defines move start variables,
- encodes resource/node capacity and precedence constraints,
- preserves canonical per-entity move ordering,
- minimizes start-time objective under bounds.

Source: `fuelflow/engine/opt/cpsat_adapter.py`.

### 8.4 Post-solve Validation Stage

Feasible solutions are replayed through simulation and rescored. Service layer protects against structural drift and returns structured outcome classes with lock metadata and optional artifacts (`fuelflow/services.py`).

## 9) Workbench Architecture Explained

The workbench is not only a viewer; it is a stateful orchestration client:
- **Builder**: model editing, save/revert/save-as, scaffolding actions, fork UI.
- **Simulate**: runtime mode selection and linked visual analysis.
- **Optimize**: lock controls and optimization application workflow.

`OptimizeView` explicitly states algorithm selection is UI-only in current release, which is an important behavior detail for users and reviewers (`workbench/src/components/views/OptimizeView.tsx`).

## 10) Persistence, Determinism, and Safety

- YAML write path safety (root containment + symlink rejection),
- stale-write rejection via digest comparison,
- atomic file replacement with fsync,
- canonical digesting with float normalization,
- artifact bundles with deterministic digest metadata.

Sources: `fuelflow/io/yaml_io.py`, `fuelflow/io/canonical.py`, `fuelflow/io/artifacts.py`.

## 11) Dependency Architecture

### Backend

From `pyproject.toml`:
- `fastapi`, `pydantic`, `pyyaml`, `typer`, `uvicorn`, `ortools`
- pytest-based dev dependencies

### Workbench

From `workbench/package.json`:
- `react`, `react-dom`
- dev stack: `typescript`, `vite`, `@vitejs/plugin-react`, types packages

## 12) Test Architecture and Coverage Signals

The tests function as an executable architecture contract:
- API shape and parity tests (`tests/test_api.py`, `tests/test_library_api.py`)
- optimizer lock and timing-first behavior (`tests/test_optimizer_conformance.py`)
- determinism and artifact consistency (`tests/test_determinism.py`)
- fairness/contention handling (`tests/test_fairness.py`)
- persistence and adversarial IO checks (`tests/test_persistence.py`)
- OpenAPI path freeze (`tests/test_contract_freeze.py`)

This gives strong confidence that architectural invariants are intentionally enforced.

## 13) Constraints, Assumptions, and Known Risks

### 13.1 Visible constraints/assumptions

- local loopback runtime default,
- in-process concurrency cap (`MAX_CONCURRENT_RUNS = 2`),
- hard horizon cap for scenario loads,
- seed-schedule dependence for optimize path,
- file-based persistence conventions.

Sources: `scripts/start.sh`, `fuelflow/services.py`, `fuelflow/io/paths.py`.

### 13.2 Key risks

1. **UI/backend feature gap risk**  
   Algorithm selector appears richer than backend selection contract.
2. **Complex lock semantics risk**  
   Matrix applicability + warnings + solver-encoding differences increase cognitive and maintenance complexity.
3. **Scalability risk**  
   Single-process concurrency controls and filesystem persistence do not provide distributed robustness.

## 14) Recommended Architecture Actions

1. Align optimization algorithm UX and backend contract.
2. Extract run management (queueing/cancellation/telemetry) into a dedicated subsystem.
3. Improve lock-effect observability in returned artifacts and UI summaries.
4. Introduce storage abstraction seams if hosted or multi-user operation is expected.
5. Keep and expand conformance tests for lock and deterministic behavior as complexity grows.

## 15) Primary Source Index

### Runtime and Interfaces
- `scripts/start.sh`
- `scripts/install.sh`
- `fuelflow/api/app.py`
- `fuelflow/cli.py`
- `fuelflow/__init__.py`
- `workbench/src/App.tsx`
- `workbench/src/api.ts`
- `workbench/vite.config.ts`

### Domain and Kernel
- `fuelflow/services.py`
- `fuelflow/scenario/model.py`
- `fuelflow/scenario/fork.py`
- `fuelflow/scenario/validation.py`
- `fuelflow/constraints/vocabulary.py`
- `fuelflow/engine/sim/simulator.py`
- `fuelflow/engine/opt/cpsat_adapter.py`
- `fuelflow/engine/opt/locks.py`
- `fuelflow/objectives/scoring.py`
- `fuelflow/topology/models.py`
- `fuelflow/resources/models.py`
- `fuelflow/entities/models.py`
- `fuelflow/physics/decay.py`

### Persistence and Determinism
- `fuelflow/io/yaml_io.py`
- `fuelflow/io/canonical.py`
- `fuelflow/io/artifacts.py`
- `fuelflow/io/paths.py`

### Workbench Views
- `workbench/src/components/views/BuilderView.tsx`
- `workbench/src/components/views/SimulateView.tsx`
- `workbench/src/components/views/OptimizeView.tsx`
- `workbench/src/components/ResultsInspector.tsx`

### Tests
- `tests/test_api.py`
- `tests/test_library_api.py`
- `tests/test_contract_freeze.py`
- `tests/test_conformance.py`
- `tests/test_optimizer_conformance.py`
- `tests/test_determinism.py`
- `tests/test_fairness.py`
- `tests/test_persistence.py`
- `tests/test_paths.py`
