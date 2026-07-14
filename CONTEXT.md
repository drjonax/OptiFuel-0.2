# OptiFuel

Nuclear fuel handling workflow optimiser for multi-unit SMR plants. Models how individual fuel assemblies move through a plant over time, subject to resource contention, thermal limits, and outage windows.

## Language

**Assembly**:
A single fuel assembly — the smallest schedulable entity. Every entity in the model is one assembly; there is no batch or composite construct.
_Avoid_: Fuel unit, batch, bundle

**Scenario**:
An immutable, validated problem instance: plant topology, initial entities, arrival/departure schedule, physics bindings, constraints, resources, unit modes, horizon, and objective configuration. Once validated, a Scenario does not change during simulation — amendments produce a new Scenario via forking.
_Avoid_: Case, model, setup

**Schedule**:
A planned sequence of moves for a Scenario — each move binds an assembly to an edge at a start time. Distinct from the Scenario itself; a Scenario can be evaluated against many Schedules.
_Avoid_: Plan, programme, timeline

**Move**:
A single planned or executed transfer of one assembly along one edge, starting at a simulation time. The optimizer and simulator reason about moves, not abstract "operations."
_Avoid_: Transfer, operation, hop

**Fork**:
Creating a new Scenario from a parent at a point in simulated history, with declared amendments. Legal only at event boundaries. The mechanism for mid-horizon replanning.
_Avoid_: Branch, snapshot, clone

**Topology**:
The directed graph of legal rest states — nodes (stores, cores, pools, staging areas) and edges (transfers between nodes). Defines where assemblies may be, not when they move.
_Avoid_: Layout, network, map

**Node**:
A legal rest state in the topology — a location where an assembly can dwell. Types include fresh store, corridor staging, core, interim pool, and long-term storage.
_Avoid_: Location, zone, area

**Edge**:
A legal transfer path between two nodes. May require shared resources (e.g. fuel handling machine, corridor transit) and has a duration.
_Avoid_: Route, link, connection

**Resource**:
A consumable capacity shared across units — not a resting location. Types include fuel handling machine, corridor transit, crew, and cask. Contention for resources is the primary scheduling challenge.
_Avoid_: Equipment (too generic), asset

**Unit**:
One reactor unit in a multi-unit plant. Units share corridor transit, fuel handling machines, crews, and long-term storage but have their own cores and interim pools.
_Avoid_: Reactor (when meaning the unit as a planning entity), module

**Unit mode**:
A per-unit operating window — power, shutdown, or refueling — that gates when refueling moves are eligible. In v1, mode windows are Scenario input, not optimizer decision variables.
_Avoid_: State, status, operating condition

**Boundary flow**:
Fuel entering or leaving the modeled system — fresh assemblies arriving at source nodes, spent assemblies departing via sink nodes. Distinct from moves within the plant.
_Avoid_: Import/export, inflow/outflow

**Simulation time**:
Time within the model, measured in minutes from the scenario start. Not calendar date — date/timezone mapping is an IO concern only.
_Avoid_: Real time, clock time, timestamp

**Violation**:
A constraint rule that evaluates to false at a point in simulation. Hard violations make a schedule infeasible; soft violations are recorded but do not fail the run (depending on runtime mode).
_Avoid_: Error, breach, infraction

**Constraint**:
A named evaluable domain rule in the closed rule vocabulary that is checked during a run. Constraints are the source of violations when they evaluate to false.
_Avoid_: Check, validator, policy

**Move status**:
The lifecycle label of a move within a run timeline. In v1 the canonical statuses are `planned` (present in the schedule, not yet applied) and `executed` (applied in simulation history).
_Avoid_: Proposed/committed, scheduled/completed

**Objective**:
A weighted, normalized composite score across multiple terms (e.g. outage duration, peak storage heat, handling operation count). Used to compare schedules for the same Scenario.
_Avoid_: Cost, fitness, utility

**Optimization outcome**:
The result class from an optimization attempt for a Scenario: feasible schedule, infeasible, or timeout. Timeout is distinct from infeasible and means feasibility is still unknown.
_Avoid_: Solver status, result code

**Run**:
One execution of a Scenario against a Schedule, producing a timeline, violation list, objective score, and artifact bundle.
_Avoid_: Execution, job, simulation (when meaning the act of running)

**Workbench**:
The planning UI where users load scenarios, adjust parameters and schedules, fork for mid-horizon replanning, trigger simulation and optimization, and inspect results.
_Avoid_: Dashboard, portal, app
