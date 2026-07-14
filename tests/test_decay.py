"""Decay model conformance tests."""

from __future__ import annotations

from fuelflow.io.yaml_io import load_yaml
from fuelflow.physics.decay import DecayModel, DecayTableEntry
from fuelflow.scenario.model import Scenario
from fuelflow.scenario.validation import validate_scenario


def test_decay_table_replay_stable() -> None:
    model = DecayModel(
        entity_id="X",
        table=[
            DecayTableEntry(time_min=0, heat_kw=1.0),
            DecayTableEntry(time_min=100, heat_kw=3.0),
            DecayTableEntry(time_min=200, heat_kw=2.0),
        ],
    )
    assert model.heat_kw(0) == model.heat_kw(0)
    assert model.heat_kw(50) == 2.0
    assert model.heat_kw(200) == 2.0
    assert model.heat_kw(500) == 2.0


def test_missing_decay_table_rejected() -> None:
    scenario = Scenario.model_validate(
        {
            "schema_version": 4,
            "id": "bad_decay",
            "horizon_min": 100,
            "topology": {"nodes": [], "edges": []},
            "entities": [],
            "resources": [],
            "physics": {"decay_models": [{"entity_id": "A1", "table": []}]},
        }
    )
    issues = validate_scenario(scenario)
    assert any("Decay table missing" in issue.message for issue in issues)


def test_reference_decay_models_present() -> None:
    from tests.conftest import REFERENCE_SCENARIO

    scenario = Scenario.model_validate(load_yaml(REFERENCE_SCENARIO))
    issues = validate_scenario(scenario)
    assert not any("Decay table missing" in issue.message for issue in issues)
