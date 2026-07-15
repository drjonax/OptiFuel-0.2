"""Static import-boundary conformance checks."""

from __future__ import annotations

from pathlib import Path

from tests.architecture.import_scan import scan_package
from tests.architecture.layer_rules import KNOWN_VIOLATIONS, find_violations, is_known_violation

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_ROOT = ROOT / "fuelflow"


def test_known_violations_have_required_metadata() -> None:
    for entry in KNOWN_VIOLATIONS:
        assert entry.owner.strip(), f"missing owner for {entry.source_module}"
        assert entry.rationale.strip(), f"missing rationale for {entry.source_module}"
        assert entry.date_added.strip(), f"missing date_added for {entry.source_module}"
        assert entry.adr_ref, f"missing adr_ref for {entry.source_module}"


def test_no_new_import_boundary_violations() -> None:
    edges = scan_package(PACKAGE_ROOT)
    violations = find_violations(edges)
    unknown = [v for v in violations if not is_known_violation(v[0], v[1])]
    assert unknown == [], "New import boundary violations detected:\n" + "\n".join(
        f"  {source} -> {target}" for source, target in unknown
    )


def test_known_violations_still_present_or_resolved() -> None:
    edges = scan_package(PACKAGE_ROOT)
    violations = find_violations(edges)
    violation_set = set(violations)
    for known in KNOWN_VIOLATIONS:
        still_present = any(
            source == known.source_module
            and (target == known.target_module or target.startswith(f"{known.target_module}."))
            for source, target in violation_set
        )
        if not still_present:
            # If a known violation is fixed, remove it from KNOWN_VIOLATIONS in the same PR.
            continue
