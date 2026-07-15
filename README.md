# OptiFuel v1-alpha

Local-first nuclear fuel handling workflow optimiser for multi-unit SMR plants.

## Quick start

### Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
optifuel serve
```

API runs at `http://127.0.0.1:8000` by default (loopback only).

### CLI

```bash
optifuel validate examples/reference_plant/scenario.yaml
optifuel simulate examples/reference_plant/scenario.yaml examples/reference_plant/schedule.yaml
optifuel optimize examples/reference_plant/scenario.yaml
optifuel benchmark examples/reference_plant/scenario.yaml
```

### Workbench UI

```bash
cd workbench
npm install
npm run dev
```

Workbench runs at `http://127.0.0.1:5173` and proxies API calls to the backend.

## Layout

- `fuelflow/` — Python kernel, API, CLI
- `workbench/` — React TypeScript planning workbench
- `examples/` — Representative 3+ unit scenario fixtures
- `tests/` — Conformance, golden, determinism suites

## Library scoring API

Objective scoring uses layer-neutral metrics, not simulator result types directly:

```python
from fuelflow import simulate, score_objective, ObjectiveMetrics, Scenario, Schedule

sim = simulate(scenario, schedule)
score = score_objective(sim.to_objective_metrics(), scenario.objective)
```

Import-boundary conformance is enforced in `tests/test_import_boundaries.py` (see `docs/adr/0002-v8-layer-conformance.md`).

## Release phases

- **v1-alpha** (phase-1): kernel + API + CLI + MVP workbench with fork UI
- **v1** (phase-2): full v9 UI conformance (topology playback, linked Gantt)
