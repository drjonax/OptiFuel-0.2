"""Path helper tests."""

from fuelflow.io.paths import resolve_seed_schedule_path, sibling_schedule_path

from tests.conftest import REFERENCE_SCENARIO, ROOT


def test_sibling_schedule_path() -> None:
    assert sibling_schedule_path("examples/reference_plant/scenario.yaml") == "examples/reference_plant/schedule.yaml"


def test_resolve_seed_explicit() -> None:
    explicit = ROOT / "examples/reference_plant/schedule.yaml"
    resolved = resolve_seed_schedule_path(
        REFERENCE_SCENARIO,
        ROOT,
        explicit_seed_path=explicit,
    )
    assert resolved == explicit


def test_resolve_seed_auto_from_scenario() -> None:
    resolved = resolve_seed_schedule_path(REFERENCE_SCENARIO, ROOT)
    assert resolved == ROOT / "examples/reference_plant/schedule.yaml"
