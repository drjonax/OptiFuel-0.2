# v9 MUST Traceability Checklist

| v9 MUST | Module | Verification | Evidence |
|---|---|---|---|
| 3+ unit representative plant | examples/reference_plant/scenario.yaml | integration | tests/test_golden.py::test_short_ci_reference_feasible |
| Shared resources fhm/corridor/crew/cask | fuelflow/resources/models.py | unit | examples/reference_plant/scenario.yaml |
| Boundary flows entity_created/departed | fuelflow/engine/sim/simulator.py | integration | tests/test_golden.py::test_short_ci_reference_feasible |
| Equal-time phase semantics | fuelflow/engine/sim/simulator.py | integration | tests/test_determinism.py::test_timeline_byte_identical_replay |
| fail_fast and continue_and_report | fuelflow/engine/sim/simulator.py | integration | tests/test_conformance.py |
| Closed constraint vocabulary | fuelflow/constraints/vocabulary.py | unit | tests/test_conformance.py::test_constraint_families |
| Pluggable DecayModel | fuelflow/physics/decay.py | unit | tests/test_decay.py |
| Scenario.fork contract | fuelflow/scenario/fork.py | integration | tests/test_conformance.py::test_fork_at_boundary |
| Optimizer feasible/infeasible_or_timeout | fuelflow/engine/opt/cpsat_adapter.py | integration | tests/test_optimizer_conformance.py |
| Objective weighted scoring + parity | fuelflow/objectives/scoring.py | unit/integration | tests/test_optimizer_conformance.py::test_optimizer_objective_parity |
| Local artifact bundles | fuelflow/io/artifacts.py | integration | tests/test_determinism.py::test_artifact_files_use_canonical_json |
| YAML persistence + stale-write safety | fuelflow/io/yaml_io.py | unit/integration | tests/test_persistence.py |
| FastAPI localhost backend | fuelflow/api/app.py | integration | tests/test_api.py |
| CLI surface | fuelflow/cli.py | integration | tests/test_library_api.py |
| API/CLI parity | fuelflow/services.py | integration | tests/test_api.py::test_api_cli_simulate_parity |
| Library API entrypoints | fuelflow/__init__.py | integration | tests/test_library_api.py |
| Contract freeze envelopes | fuelflow/api/app.py | snapshot | tests/test_contract_freeze.py |
| Fairness under contention | fuelflow/engine/sim/simulator.py | unit | tests/test_fairness.py |
| MVP workbench edit/run/inspect/fork | workbench/src | e2e/manual | workbench build + README |
| Phase-2 topology/timeline/Gantt | workbench/src/components + lib/playback.ts | integration/manual | workbench phase-2 linked views |

## Conformance suite layout

- `tests/test_golden.py` — short CI + medium-horizon + infeasible golden cases
- `tests/test_determinism.py` — byte-identical replay and canonical artifact serialization
- `tests/test_decay.py` — DecayModel validation and replay stability
- `tests/test_fairness.py` — contention ordering invariants
- `tests/test_optimizer_conformance.py` — feasibility, parity, zero-hard-violation acceptance
- `tests/test_persistence.py` — path safety, stale writes, guardrails, temp cleanup
- `tests/test_api.py` — API integration, etag saves, API/CLI parity
- `tests/test_library_api.py` — public `fuelflow` entrypoints
- `tests/test_contract_freeze.py` — OpenAPI contract snapshot
- `tests/test_conformance.py` — core kernel regression coverage
