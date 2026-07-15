# Optimiser baseline mapping (OptiFuel-0.2)

Source: `OptiFuel` branch `optimiser` — `createMultiUnitDraft()` + `eventClockParameterPreset()`.

## Starting conditions

| Optimiser field | Value | OptiFuel-0.2 mapping | Status |
|---|---|---|---|
| `unitCount` | 2 | topology units `U1`, `U2` | mapped |
| `efasPerUnit` | 1 (baseline) / >1 supported | entities with `home_unit` + staggered schedule starts | mapped / extended |
| `unitSet[].id` | `UNIT-001`, `UNIT-002` | units `U1`, `U2` (repo-native IDs) | derived |
| `efaSet[].id` | `EFA-001`, `EFA-002` | entities `A1`, `A2` | derived |
| `campaign.failFastMode` | `campaign_fail_fast` | event-clock seed infeasible, optimizer retimes | derived |
| `campaign.stepSyncMode` | `event_clock` | schedule start offsets + unit refueling windows | mapped |
| `efa.startOffsetMin` (unit 2) | `200` | `A2` seed move offsets retimed to `200` by optimizer | mapped |
| `site.unitOrder` | `UNIT-001`, `UNIT-002` | `unit_modes` order `U1`, `U2` | mapped |

## Global parameters (`eventClockParameterPreset`)

| Optimiser parameter | Value | OptiFuel-0.2 mapping | Status |
|---|---|---|---|
| `fhmCount` | 1 | single `fhm_1` resource shared by `U1`,`U2` | mapped (editable in Build UI; round-robin unit legs when >1) |
| `corridorCapacity` | 1 | `corridor_transit.capacity: 1` | mapped |
| `corridorTransitMin` | 30 min | `fresh_to_staging.duration_min.base_min: 30` | mapped |
| `fhmCycleMin` | 45 min | `staging_to_core_* .duration_min.base_min: 45` | mapped |
| `coolingDwellMin` | 120 min | `regulatory_cooling.required_cooling_min: 120`, `pool_*_to_lts.base_min: 120` | mapped |
| `residenceTimeY` | 0.000001 years | short `core_exit_states.discharge_time_min` (~1 min after core entry) | mapped |
| `efaDecayHeatW` | 1500 W | entity `heat_kw: 1.5`, decay table peak `1.5 kW` | mapped |
| `transferDecayHeatLimitW` | 2000 W | nearest equivalent `thermal_lts.max_heat_kw: 2000` | derived |
| `fhmHandlingDecayHeatLimitW` | 8000 W | not representable as direct constraint in v1 schema | not representable |
| `coolingCapacityKw` | 500 kW | `thermal_pool_* .max_heat_kw: 500` | mapped |
| `slotsFresh` | 4 | no direct fresh-store slot constraint in v1 schema | not representable |
| `slotsInterim` | 6 | no direct interim slot constraint in v1 schema | not representable |
| `slotsInterim2` | 12 | no direct LTS slot constraint in v1 schema | not representable |
| `fhmRepositionMin` | 20 min | not represented in edge durations (shared FHM contention via resource lock) | not representable |

## Compatibility invariants preserved

- Scenario path: `examples/reference_plant/scenario.yaml`
- Scenario id: `reference_plant`
- Schedule scenario reference: `reference_plant`

## Before → after baseline

| Item | Before | After |
|---|---|---|
| Units | 4 (`U1`–`U4`) | 2 (`U1`, `U2`) |
| EFAs / entities | 6+ (`A1`–`A7`, arrivals) | 2 (`A1`, `A2`) |
| FHM resources | `fhm_1`, `fhm_2` | `fhm_1` only |
| Horizon | `10080` min | `1440` min |
| Unit-2 EFA start offset | n/a | `200` min (optimizer target) |
| Pool thermal cap | `500 kW` | `500 kW` (unchanged intent) |
| Regulatory cooling | `120` min required | `120` min required (unchanged) |
| Staging contention | `max_entities: 2` | `max_entities: 1` (shared staging contention) |
