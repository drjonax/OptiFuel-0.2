# v1 implementation scope

OptiFuel v1 delivers a representative multi-unit plant simulator, a minimal optimizer adapter, and a local planning workbench — scoped to prove the full fuel-handling loop end-to-end without building operational infrastructure (run services, idempotency, checkpoints) or production-grade optimization.

**Considered options:** A stripped-down single-unit proof (rejected — doesn't exercise cross-unit contention); simulator-only without UI (rejected — users must adjust scenarios and replan interactively); deferring kernel forking while shipping fork/replan UI (rejected — would duplicate fork semantics in the UI layer).

**In scope (kernel):** Representative plant (3+ units, all four resource types: fuel handling machine, corridor transit, crew, cask); tiered golden scenario suite (short CI + medium-horizon reference); full event kernel with static unit modes, closed constraint vocabulary, full boundary flows, pluggable decay model with tabulated core exit states; full `Scenario.fork()` contract; one minimal optimizer adapter with `infeasible_or_timeout` contract; full weighted objective layer with adapter parity tests; local artifact bundles; same-platform byte-identical determinism; both `fail_fast` and `continue_and_report` violation modes; benchmark harness without pass/fail gate; Python library + CLI.

**In scope (UI):** Local planning workbench (React frontend + FastAPI backend on localhost). Users edit scenario parameters and schedules, fork for mid-horizon replanning, trigger sim and optimizer runs, inspect results via topology diagram with timeline playback and a linked table/Gantt schedule editor. Topology graph structure is loaded from YAML, not edited in UI. Edits persist to local YAML files.

**Deferred to v1.1+:** Topology graph editor; full geometry view; fork lineage browser; `custom` constraints and sandbox; idempotency/dedupe/retention; checkpoints and crash recovery; log redaction; mixed-version routing; performance release gate; cross-platform determinism envelope; unit modes as optimizer decision variables; production-grade solver adapter; auth and hosted deployment.
