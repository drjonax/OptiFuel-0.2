# Python optimisation models for OptiFuel and implementation guidance

## Problem restatement for this repo

OptiFuel schedules **assembly-level moves** over simulation time on a directed topology graph under shared resource contention (fuel handling machine, corridor transit, crew, cask), unit-mode windows, boundary flows, and hard feasibility constraints. The optimizer contract in scope is deliberately small (`feasible schedule` vs `infeasible` vs `timeout/unknown`), so model choices should prioritize reliable feasibility detection and deterministic artifact generation before chasing global optimality on very large horizons.

## Candidate model families

### 1) Time-indexed MILP (baseline exact model)

**When it fits**
- Strong default for v1 when you need predictable status semantics and easy objective weighting.
- Works well when horizon discretization is acceptable and move durations can be represented on a discrete time grid.

**Decision variables / constraints sketch**
- Binary move-start variables: `x[m, t] = 1` if move `m` starts at time bucket `t`.
- Optional occupancy/resource binaries to enforce capacities.
- Constraints:
  - each required move starts exactly once (or at most once for optional moves),
  - precedence between moves,
  - shared resource capacities per time bucket,
  - unit-mode eligibility windows,
  - boundary-flow conservation and storage limits.

**Objective alignment**
- Weighted linear objective is straightforward (outage penalties, operation counts, heat proxy penalties).
- Natural fit for your weighted normalized objective layer.

**Scalability tradeoffs**
- Main cost driver is horizon granularity (`|moves| * |time buckets|` variable growth).
- Tight formulations and preprocessing matter for larger scenarios.

**Python tooling**
- Pyomo as model layer with pluggable solvers via `SolverFactory`/APPSI ([Pyomo APPSI docs](https://pyomo.readthedocs.io/en/stable/reference/topical/appsi/appsi.html)).
- Open-source backend: HiGHS via SciPy `milp` wrapper or Pyomo/HiGHS ([SciPy `milp`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html), [HiGHS solvers](https://ergo-code.github.io/HiGHS/dev/solvers/)).

### 2) CP-SAT interval scheduling (resource-centric combinatorial model)

**When it fits**
- Very strong when the core difficulty is disjunctive/cumulative scheduling with optional activities and complex precedence.
- Good for modeling shared equipment contention and timing windows directly.

**Decision variables / constraints sketch**
- Interval variable per candidate move (`start`, `size`, `end`) and optional intervals for alternative move realizations.
- `add_no_overlap(...)` on unary resources (one-at-a-time machine/corridor variants).
- `add_cumulative(...)` for shared capacities and crew/cask availability.
- Boolean presence literals and precedence implications for conditional logic.

**Objective alignment**
- Supports weighted linear objectives over integer/bool expressions and makespan-like terms.
- Multi-term objective can be encoded directly, then mapped to OptiFuel’s objective breakdown.

**Scalability tradeoffs**
- Often excellent for scheduling-heavy structure; less transparent LP relaxation than MILP.
- Determinism requires careful parameterization/model build order.

**Python tooling**
- OR-Tools CP-SAT Python API (`CpModel`, interval vars, cumulative/no-overlap) ([CP-SAT guide](https://developers.google.com/optimization/cp/cp_solver), [Python API](https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html), [scheduling API source](https://github.com/google/or-tools/blob/stable/ortools/sat/python/cp_model.py)).

### 3) GDP-to-MIP/MINLP (disjunctive logic-first formulation)

**When it fits**
- Useful when unit-mode and process logic become richer and easier to express as disjunctions than ad-hoc binaries.
- Better suited to v1.1+ as the rule vocabulary grows.

**Decision variables / constraints sketch**
- High-level disjuncts for mutually exclusive operating/logical regimes.
- Reformulate with Big-M or Hull transformations to solver-compatible models.

**Objective alignment**
- Same weighted objective can remain at algebraic level after transformation.

**Scalability tradeoffs**
- Big-M gives smaller transformed models but weaker relaxations.
- Hull gives tighter relaxations but larger lifted formulations and stricter variable bound requirements.

**Python tooling**
- Pyomo.GDP with `TransformationFactory('gdp.bigm')` or `TransformationFactory('gdp.hull')` ([Pyomo GDP solving](https://pyomo.readthedocs.io/en/6.9.3/explanation/modeling/gdp/solving.html), [BigM transformation API](https://pyomo.readthedocs.io/en/6.8.2/api/pyomo.gdp.plugins.bigm.BigM_Transformation.html)).

### 4) Time-expanded network flow decomposition (flow first, schedule second)

**When it fits**
- Useful when movement topology/throughput dominates and can be separated from detailed machine-level timing.
- Good candidate for fast lower bounds and feasible warm starts.

**Decision variables / constraints sketch**
- Build time-expanded graph where nodes are `(location, time)` and arcs represent legal stay/move transitions.
- Solve min-cost flow for coarse assignment/throughput.
- Repair/refine with CP-SAT or MILP scheduling pass for detailed resource feasibility.

**Objective alignment**
- Arc costs can embed objective proxies (delays, congestion, handling costs).
- Refiner stage can optimize full weighted objective.

**Scalability tradeoffs**
- Very scalable coarse stage; loses fidelity unless followed by repair.
- Best as a decomposition layer rather than final answer alone.

**Python tooling**
- OR-Tools `SimpleMinCostFlow` ([OR-Tools min-cost flow guide](https://developers.google.com/optimization/flow/mincostflow), [Python API](https://or-tools.github.io/docs/pdoc/ortools/graph/python/min_cost_flow.html)).
- NetworkX can prototype min-cost flow structure quickly ([NetworkX `min_cost_flow`](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html)).

### 5) Matheuristic/LNS wrapper around exact cores (improvement at scale)

**When it fits**
- For medium/large horizons where exact full-horizon optimality is too slow but high-quality feasible schedules are needed under time budgets.

**Decision variables / constraints sketch**
- Keep an incumbent feasible schedule.
- Iteratively “destroy” a neighborhood (subset of moves/time windows/resources) and “repair” with CP-SAT or MILP.
- Accept improving (or occasionally diversified) incumbents until budget expiry.

**Objective alignment**
- Directly optimizes your weighted objective in each repair subproblem.

**Scalability tradeoffs**
- Usually better anytime behavior on hard instances.
- Requires robust neighborhood design and restart policy.

**Python tooling**
- OR-Tools documentation exposes LNS concepts/operators and time-limit controls in local search contexts ([OR-Tools routing options incl. `lns_time_limit`](https://developers.google.com/optimization/routing/routing_options), [OR-Tools LNS user manual page](https://acrogenesis.com/or-tools/documentation/user_manual/manual/metaheuristics/jobshop_lns.html)).
- Original LNS concept source: Shaw 1998 and VLNS survey context ([Pisinger & Ropke survey PDF](https://backend.orbit.dtu.dk/ws/files/5293785/Pisinger.pdf)).

## Recommended stack for OptiFuel

### Default stack (recommended)
- **Model family**: CP-SAT interval scheduling for v1 optimizer adapter.
- **Why**: maps naturally to shared resources (`no_overlap`, `cumulative`), optional moves, and precedence-rich move logic.
- **Library**: OR-Tools CP-SAT Python API.
- **Adapter status mapping**:
  - `OPTIMAL` or `FEASIBLE` -> `feasible schedule`
  - `INFEASIBLE` -> `infeasible`
  - `UNKNOWN` -> `timeout` (or `infeasible_or_timeout` in current adapter vocabulary)
  - Source status semantics: [CP-SAT status docs](https://developers.google.com/optimization/cp/cp_solver)

### Fallback stack
- **Model family**: Time-indexed MILP with Pyomo + HiGHS.
- **Why**: transparent algebra, easier IIS/LP-style diagnostics in some workflows, deterministic linear model export and diffability.
- **Library**: Pyomo + HiGHS/SciPy `milp`.

## Implementation playbook (repo-aligned)

### Phase A (v1 minimal adapter, fastest path)
1. Implement `optimizer/adapter_ortools_cpsat.py` that:
   - builds interval-based model from `Scenario`,
   - applies hard constraints only (resource capacities, precedence, mode windows, boundary flow consistency),
   - runs with explicit time limit,
   - maps statuses to current `feasible / infeasible_or_timeout` contract.
2. Determinism controls:
   - deterministic model construction order (stable sorting of IDs),
   - fixed `random_seed`,
   - single worker (`num_search_workers = 1`) for strict reproducibility runs.
   - Parameter references: [Sat parameters API](https://or-tools.github.io/docs/javadoc/com/google/ortools/sat/SatParametersOrBuilder.html).
3. Artifact bundle:
   - model summary, solver params, status, objective terms, incumbent move list, timing stats.
4. Keep objective initially simple (few robust terms), then expand.

### Phase B (v1.1 quality and scale)
1. Add warm-start pathways:
   - from user-edited schedule and/or flow decomposition seed.
2. Introduce neighborhood repair loop (LNS-style):
   - freeze most of incumbent; reoptimize selected neighborhood under strict per-iteration time limit.
3. Add MILP mirror prototype for parity on small golden scenarios:
   - cross-check feasibility and objective decomposition against CP-SAT results.

### Phase C (production hardening)
1. Multi-adapter orchestration:
   - try CP-SAT first, fallback to MILP for diagnosis or vice versa by scenario signature.
2. Rich status/reporting:
   - distinguish `timeout with incumbent` vs `timeout no feasible incumbent`.
3. Benchmark policy:
   - track primal objective, feasibility rate, solve time quantiles, determinism checks across repeated runs.

## Concrete adapter integration pattern

1. **Input**: immutable validated `Scenario` + optional initial `Schedule`.
2. **Build**: create solver model with canonical variable naming (stable IDs for deterministic artifacts).
3. **Solve**: enforce time limit and seed strategy.
4. **Decode**:
   - if feasible: emit schedule in canonical move order.
   - if infeasible: emit no schedule and include conflict diagnostics if available.
   - if timeout/unknown: emit incumbent if present + explicit uncertainty flag.
5. **Return**:
   - `OptimizationOutcome` class in your domain vocabulary (`feasible schedule`, `infeasible`, `timeout`).
6. **Persist**:
   - write artifact bundle consumed by CLI/workbench.

## Risk register and validation strategy

### Key risks
- **Model explosion** on fine-grained horizons (especially MILP time-indexed).
- **Hidden nondeterminism** from unordered data structures and multithreaded search.
- **Status ambiguity** around `infeasible_or_timeout` reducing decision confidence.
- **Objective overfitting** to benchmark suite instead of operational realism.

### Mitigations
- Add deterministic build checksums and repeated-run regression tests.
- Maintain tiered golden scenarios (already in your scope) and include adversarial edge cases.
- Enforce adapter parity tests on shared small scenarios (CP-SAT vs MILP mirror).
- Keep a “feasibility-first” mode for operational runs under tight deadlines.

## Practical first implementation details

- Start with CP-SAT interval model:
  - one interval per possible move realization,
  - `add_no_overlap` for unary resources,
  - `add_cumulative` for crew/cask shared capacities,
  - precedence constraints from topology and per-assembly histories.
- Use a two-budget solve policy:
  - short feasibility budget first,
  - then improvement budget if feasible incumbent exists.
- Preserve explainability:
  - for each rejected move, record which hard constraint family blocked placement (if derivable from model bookkeeping).

## Source list (primary)

- OptiFuel scope/domain docs: `CONTEXT.md`, `docs/adr/0001-v1-implementation-scope.md` (repo primary sources).
- OR-Tools CP-SAT status and usage: <https://developers.google.com/optimization/cp/cp_solver>
- OR-Tools CP-SAT Python API: <https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html>
- OR-Tools scheduling API source (`add_cumulative`, intervals): <https://github.com/google/or-tools/blob/stable/ortools/sat/python/cp_model.py>
- OR-Tools Sat parameters (`random_seed`, workers): <https://or-tools.github.io/docs/javadoc/com/google/ortools/sat/SatParametersOrBuilder.html>
- OR-Tools min-cost flow guide/API: <https://developers.google.com/optimization/flow/mincostflow>, <https://or-tools.github.io/docs/pdoc/ortools/graph/python/min_cost_flow.html>
- Pyomo APPSI solver interfaces: <https://pyomo.readthedocs.io/en/stable/reference/topical/appsi/appsi.html>
- Pyomo GDP solving (Big-M / Hull): <https://pyomo.readthedocs.io/en/6.9.3/explanation/modeling/gdp/solving.html>
- Pyomo BigM transformation API: <https://pyomo.readthedocs.io/en/6.8.2/api/pyomo.gdp.plugins.bigm.BigM_Transformation.html>
- SciPy MILP (HiGHS wrapper): <https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html>
- HiGHS solver methods (incl. MIP branch-and-cut): <https://ergo-code.github.io/HiGHS/dev/solvers/>
- NetworkX min-cost flow API (prototype tooling): <https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html>
- LNS references: OR-Tools routing options <https://developers.google.com/optimization/routing/routing_options>, OR-Tools LNS manual page <https://acrogenesis.com/or-tools/documentation/user_manual/manual/metaheuristics/jobshop_lns.html>, VLNS survey <https://backend.orbit.dtu.dk/ws/files/5293785/Pisinger.pdf>
# Python optimisation models for OptiFuel

Date: 2026-07-14

## 1) Problem restatement for this repo

OptiFuel v1 targets a multi-unit SMR fuel-handling scheduling problem where each **assembly** moves over a directed **topology** across **simulation time**, with hard constraints on shared resources (`fhm`, `corridor_transit`, `crew`, `cask`), thermal/constraint rules, outage windows, and boundary flows.[`CONTEXT.md`](../../CONTEXT.md)[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)

v1 scope explicitly requires a simulator plus a minimal optimizer adapter returning structured outcomes (`feasible`, `infeasible`, `timeout` semantics through `infeasible_or_timeout`), weighted objective scoring, and local Python library/CLI + localhost workbench integration.[`docs/adr/0001-v1-implementation-scope.md`](../adr/0001-v1-implementation-scope.md)[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)

## 2) Candidate model families (Python-capable)

### A. Constraint Programming / CP-SAT (discrete scheduling-first)

**When it fits best**
- Rich scheduling structure with discrete durations, precedence, and shared-capacity resources (very close to machine/job-shop style patterns) maps naturally to interval-based CP-SAT modeling.[https://developers.google.com/optimization/scheduling/job_shop](https://developers.google.com/optimization/scheduling/job_shop)
- Need feasible schedules quickly under hard combinatorial constraints with optional objective improvement over remaining time.[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)

**Decision variables and constraints sketch**
- Interval variables for each candidate move `(assembly, edge, start, duration)`, optional where route alternatives exist.[https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html](https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html)
- `NoOverlap` for exclusive resources (single FHM lane, single cask usage), `Cumulative` for crew/corridor capacities.[https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html](https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html)
- Precedence and temporal windows for outage/mode eligibility and thermal cooldown chains.[https://developers.google.com/optimization/scheduling/job_shop](https://developers.google.com/optimization/scheduling/job_shop)

**Objective alignment**
- Weighted linearized objective terms (e.g., outage duration proxy, handling count, lateness) are natively expressible as integer linear expressions under CP-SAT’s objective API.[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)

**Scalability tradeoffs**
- Strong for hard scheduling feasibility; performance is highly model-dependent and can degrade with weak variable domains or excessive symmetry (typical for CP/SAT search).[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)
- Time limits and search parameters are first-class; practical for v1 “return feasible/infeasible/timeout” behavior.[https://developers.google.com/optimization/cp/cp_tasks](https://developers.google.com/optimization/cp/cp_tasks)

**Python tooling**
- `ortools.sat.python.cp_model` + `CpSolver` (official Python API).[https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html](https://or-tools.github.io/docs/pdoc/ortools/sat/python/cp_model.html)

---

### B. MILP (time-indexed or disjunctive linearization)

**When it fits best**
- Objectives/constraints are mostly linear and explainability/auditability of LP relaxations and MIP bounds are important.
- Useful when you want direct interoperability with many solvers (HiGHS, CBC, Gurobi, CPLEX).

**Decision variables and constraints sketch**
- Binary start-time variables `x[move,t]` (time-indexed) or sequencing binaries between conflicting moves.
- Flow conservation / location continuity constraints for each assembly across time layers.
- Resource capacities as linear inequalities by time bucket; outage/mode windows as forbidden buckets.

**Objective alignment**
- Direct weighted sum objective over linear terms (movement penalties, tardiness, peak proxies) is canonical MILP form.[https://developers.google.com/optimization/mip/mip_example](https://developers.google.com/optimization/mip/mip_example)

**Scalability tradeoffs**
- Time-indexed MILP can become very large with long horizons and fine granularity; gives stronger global bounds than many heuristics but may time out.
- Good fallback where CP formulation becomes difficult to maintain or where LP dual bounds are operationally important.

**Python tooling**
- Pyomo modeling components (`Set`, `Param`, `Var`, `Objective`, `Constraint`) and solver orchestration.[https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html](https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html)
- SciPy `optimize.milp` for compact MILP API; supports `time_limit`, `mip_rel_gap`, and explicit status codes; wraps HiGHS.[https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html)
- HiGHS as open-source LP/MIP/QP backend.[https://highs.dev/](https://highs.dev/)
- Optional commercial path: Gurobi status/termination codes for production MIP operations.[https://docs.gurobi.com/projects/optimizer/en/current/reference/numericcodes/statuscodes.html](https://docs.gurobi.com/projects/optimizer/en/current/reference/numericcodes/statuscodes.html)

---

### C. Network-flow specialization (min-cost flow core + side constraints)

**When it fits best**
- Subproblems dominated by movement routing/throughput with linear arc capacities/costs, especially for boundary-flow balancing and baseline transport plans.
- Effective as a fast primal heuristic or lower-complexity baseline inside a larger hybrid workflow.

**Decision variables and constraints sketch**
- Arc flow variables with node demand balance and edge capacities.
- Costed arcs for move preferences and penalties.
- Add side constraints (resource calendars/precedence) either via decomposition or post-repair stage.

**Objective alignment**
- Native min-cost objective over flow on arcs.[https://developers.google.com/optimization/flow/mincostflow](https://developers.google.com/optimization/flow/mincostflow)[https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html)

**Scalability tradeoffs**
- Extremely fast for pure flow structure, but expressiveness drops when many scheduling/logical constraints are added.
- Best used as: (a) initializer, (b) decomposition subproblem, or (c) bound/reference model.

**Python tooling**
- OR-Tools `SimpleMinCostFlow` examples/docs.[https://developers.google.com/optimization/flow/mincostflow](https://developers.google.com/optimization/flow/mincostflow)
- NetworkX `min_cost_flow` (with explicit infeasible/unbounded exceptions and integer-demand caveats).[https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.flow.min_cost_flow.html)

---

### D. Simulation-optimization / black-box search over scheduler parameters

**When it fits best**
- When exact formulations are expensive to maintain and the simulator already evaluates schedule quality/violations.
- Useful for tuning heuristic policy parameters (priority rules, penalties, horizon chunk sizes, repair thresholds).

**Decision variables and constraints sketch**
- Decision vector is heuristic/policy hyperparameters (discrete + continuous).
- Simulator is the evaluator; hard constraints enforced by repair/penalty or rejection.
- Can mix with deterministic constructive heuristic to always produce candidate schedules.

**Objective alignment**
- Directly optimize the same weighted objective score used by simulator/workbench by wrapping simulator runs as trial evaluations.[https://optuna.readthedocs.io/en/stable/](https://optuna.readthedocs.io/en/stable/)

**Scalability tradeoffs**
- Good engineering velocity and robustness to model changes; weaker optimality guarantees.
- Parallel trial execution is straightforward; reproducibility requires strict seed and artifact discipline.[https://docs.python.org/3/library/multiprocessing.html](https://docs.python.org/3/library/multiprocessing.html)[https://optuna.readthedocs.io/en/stable/](https://optuna.readthedocs.io/en/stable/)

**Python tooling**
- Optuna study/trial API with samplers/pruners and persistent study storage options.[https://optuna.readthedocs.io/en/stable/](https://optuna.readthedocs.io/en/stable/)
- Method reference: Optuna KDD paper / arXiv preprint.[https://arxiv.org/abs/1907.10902](https://arxiv.org/abs/1907.10902)

## 3) Recommended stack for OptiFuel

### Default stack (recommended)
- **Model family:** CP-SAT for core move scheduling and shared-resource contention.
- **Python stack:** OR-Tools CP-SAT adapter + simulator objective scoring/parity checks.
- **Why:** Matches interval/resource scheduling structure directly and supports strict time-boxing (`max_time_in_seconds`) required by v1 outcome semantics.[https://developers.google.com/optimization/cp/cp_tasks](https://developers.google.com/optimization/cp/cp_tasks)[https://developers.google.com/optimization/scheduling/job_shop](https://developers.google.com/optimization/scheduling/job_shop)

### Fallback stack
- **Model family:** MILP with Pyomo + HiGHS (or SciPy `milp` for smaller adapters).
- **Why fallback:** Strong linear modeling ecosystem, explicit solver statuses, and easy solver backend substitution as the model matures.[https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html](https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html)[https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html)[https://highs.dev/](https://highs.dev/)

## 4) Concrete integration pattern with current architecture

This pattern is aligned with the v1 architecture requirement of “minimal adapter + objective parity + deterministic artifacts”.[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)[`docs/adr/0001-v1-implementation-scope.md`](../adr/0001-v1-implementation-scope.md)

### Adapter contract (proposed)

```python
from dataclasses import dataclass
from typing import Literal, Optional

Outcome = Literal["feasible", "infeasible", "timeout"]

@dataclass(frozen=True)
class OptimizerResult:
    outcome: Outcome
    schedule: Optional["Schedule"]        # present only when outcome == "feasible"
    objective_score: Optional[float]      # computed via Objective.score(schedule)
    solver_status_raw: str                # raw backend status string/code
    wall_time_s: float
    seed: int
    artifact_dir: str
```

### Status mapping rules
- **CP-SAT:** map `OPTIMAL`/`FEASIBLE` -> `feasible`, `INFEASIBLE` -> `infeasible`, `UNKNOWN` after time limit -> `timeout`.[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)[https://developers.google.com/optimization/cp/cp_tasks](https://developers.google.com/optimization/cp/cp_tasks)
- **SciPy/HiGHS MILP:** `status=0` -> `feasible` (optimal), `status=2` -> `infeasible`, `status=1` -> `timeout` (iteration/time/node limit reached).[https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html)
- **Pyomo:** use `TerminationCondition` (`optimal/feasible`, `infeasible`, `maxTimeLimit`) for unified adapter mapping.[https://pyomo.readthedocs.io/en/stable/howto/solver_recipes.html](https://pyomo.readthedocs.io/en/stable/howto/solver_recipes.html)[https://pyomo.readthedocs.io/en/stable/_modules/pyomo/opt/results/solver.html](https://pyomo.readthedocs.io/en/stable/_modules/pyomo/opt/results/solver.html)

### Deterministic seeds and artifacts
- Persist solver seed and all solve parameters in run metadata; for CP-SAT expose `random_seed`, `max_time_in_seconds`, and worker count in artifacts.[https://or-tools.github.io/docs/javadoc/com/google/ortools/sat/SatParametersOrBuilder.html](https://or-tools.github.io/docs/javadoc/com/google/ortools/sat/SatParametersOrBuilder.html)
- Keep a canonical input digest (`scenario + objective config + adapter config`) and output digest per run, matching v1 determinism requirements.[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)

### Objective parity handling
- Always compute final score via the core `Objective.score()` path used by simulator/workbench, even if solver had an internal objective; fail parity check outside tolerance.[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)

## 5) Implementation playbook for this repo

### Phase v1 (minimal adapter, ship quickly)
1. Implement CP-SAT adapter for feasible schedule construction under hard constraints + wall-clock limit.[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)
2. Map solver statuses to `feasible` / `infeasible` / `timeout` and always emit structured artifacts.[https://developers.google.com/optimization/cp/cp_tasks](https://developers.google.com/optimization/cp/cp_tasks)[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)
3. Run objective parity check against simulator scoring function and record mismatch diagnostics.[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)
4. Expose adapter through library + CLI surface expected in v1 scope.[`docs/adr/0001-v1-implementation-scope.md`](../adr/0001-v1-implementation-scope.md)

### Phase v1.1+ (quality and breadth)
1. Add MILP fallback adapter (Pyomo+HiGHS) for scenarios where CP formulation underperforms or needs linear-audit workflows.[https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html](https://pyomo.readthedocs.io/en/stable/getting_started/pyomo_overview/overview_components.html)[https://highs.dev/](https://highs.dev/)
2. Add flow-based initializer to warm-start CP/MILP schedules for boundary-heavy cases.[https://developers.google.com/optimization/flow/mincostflow](https://developers.google.com/optimization/flow/mincostflow)
3. Add Optuna tuning loop for adapter hyperparameters (penalty weights, horizon chunking, restart policy).[https://optuna.readthedocs.io/en/stable/](https://optuna.readthedocs.io/en/stable/)

### Production hardening
1. Add robust timeout budgets by scenario class, and explicit degraded-mode policies for `timeout`.
2. Add reproducibility profile: fixed seeds, deterministic solver settings, strict artifact schema, and replay checks.[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)
3. Add solver observability: status histogram, solve time distributions, infeasibility diagnostics, and parity drift alarms.
4. Optionally add commercial solver backend (e.g., Gurobi) for larger industrial instances with equivalent adapter contract.[https://docs.gurobi.com/projects/optimizer/en/current/reference/numericcodes/statuscodes.html](https://docs.gurobi.com/projects/optimizer/en/current/reference/numericcodes/statuscodes.html)

## 6) Risks and validation strategy

### Key risks
- **Modeling mismatch risk:** schedule semantics diverge between optimizer variables and simulator event kernel.
- **Timeout ambiguity risk:** solver returns partial progress but no feasibility proof.
- **Determinism risk:** parallelism/seed handling yields non-replayable outcomes.
- **Objective drift risk:** adapter-internal objective differs from canonical objective scorer.

### Validation strategy
- **Benchmark harness:** tiered scenario pack (short CI + medium reference), fixed hardware/profile tags, and wall-time reporting as required by v1 docs.[`docs/adr/0001-v1-implementation-scope.md`](../adr/0001-v1-implementation-scope.md)[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)
- **Outcome parity tests:** force known feasible/infeasible/timeout fixtures and assert adapter mapping against backend statuses.[https://developers.google.com/optimization/cp/cp_solver](https://developers.google.com/optimization/cp/cp_solver)[https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.milp.html)
- **Golden scenarios:** store scenario+config digests and expected artifact manifests; replay must be byte-identical on same platform profile (v1 determinism boundary).[`FUEL_FLOW_ARCHITECTURE_v9.md`](../../FUEL_FLOW_ARCHITECTURE_v9.md)
- **Cross-adapter checks:** run identical scenarios on CP-SAT and MILP fallback; compare feasibility and objective parity tolerance bands.

## 7) Practical decision

For OptiFuel today, implement **CP-SAT as the default adapter** and keep **Pyomo+HiGHS MILP as fallback**. This combination best matches the current architecture’s need to ship v1 quickly with strong scheduling feasibility behavior, explicit timeout handling, and future-safe room for industrial hardening.
