# v8 layer conformance refactor

Restores practical conformance with `FUEL_FLOW_ARCHITECTURE_v8.md` layer dependency rules by decoupling the Objective layer from Engine types and adding CI-enforced import-boundary checks.

**Considered options:** Strict literal conformance including scenario fork decoupling (deferred — larger ripple into fork replay semantics); documenting drift without code changes (rejected — no preventive guardrails); backward-compatible `score_objective(sim, ...)` wrapper (rejected — explicit API break accepted for v1-alpha).

**Changes implemented:**
- Added `ObjectiveMetrics` in `fuelflow/objectives/metrics.py` as the layer-neutral scoring input contract.
- Refactored `score_objective(metrics, config)` to remove `fuelflow.engine` dependency from the objectives layer.
- Engine call sites project simulation output via `SimulationResult.to_objective_metrics()`.
- Public library API now exports `ObjectiveMetrics`; `score_objective` signature is breaking.

**CI enforcement:**
- AST import scanner under `tests/architecture/` with fail-on-new policy.
- Baseline allowlist (`KNOWN_VIOLATIONS`) for deferred drifts with required metadata (`owner`, `rationale`, `date_added`, `adr_ref`).

**Deferred exceptions (tracked in baseline):**
- `fuelflow.scenario.fork` → `fuelflow.engine.sim` (fork replay requires simulator timeline).
- `fuelflow.api.app` → `fuelflow.engine.opt.locks` (lock DTOs reused in API request models).
- `fuelflow.io.artifacts` → `fuelflow.engine.sim` (artifact bundle includes simulation result type).

**Follow-up:** Remove baseline entries as each seam is refactored; do not grow `KNOWN_VIOLATIONS` without updating this ADR.
