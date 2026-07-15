"""Declarative v8 layer import boundary rules."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class KnownViolation:
    source_module: str
    target_module: str
    owner: str
    rationale: str
    date_added: str
    adr_ref: str | None = None


# Pre-existing architectural drift tracked until follow-up refactors land.
KNOWN_VIOLATIONS: tuple[KnownViolation, ...] = (
    KnownViolation(
        source_module="fuelflow.scenario.fork",
        target_module="fuelflow.engine.sim.simulator",
        owner="kernel",
        rationale="Fork replay requires simulator timeline replay; deferred strict scenario/engine decoupling.",
        date_added="2026-07-15",
        adr_ref="docs/adr/0002-v8-layer-conformance.md",
    ),
    KnownViolation(
        source_module="fuelflow.api.app",
        target_module="fuelflow.engine.opt.locks",
        owner="api",
        rationale="API request models reuse optimizer lock DTOs directly; deferred move to services export seam.",
        date_added="2026-07-15",
        adr_ref="docs/adr/0002-v8-layer-conformance.md",
    ),
    KnownViolation(
        source_module="fuelflow.io.artifacts",
        target_module="fuelflow.engine.sim.simulator",
        owner="io",
        rationale="Artifact bundle serialization includes simulation result type; IO orchestration layer.",
        date_added="2026-07-15",
        adr_ref="docs/adr/0002-v8-layer-conformance.md",
    ),
)


def _prefix_match(module: str, prefix: str) -> bool:
    return module == prefix or module.startswith(f"{prefix}.")


def _import_matches(imported: str, forbidden_prefix: str) -> bool:
    return imported == forbidden_prefix or imported.startswith(f"{forbidden_prefix}.")


FORBIDDEN_RULES: tuple[tuple[str, str], ...] = (
    # Layer 7: Objective must not depend on Engine.
    ("fuelflow.objectives", "fuelflow.engine"),
    # Engine sim must not depend on engine opt (reverse dependency forbidden).
    ("fuelflow.engine.sim", "fuelflow.engine.opt"),
    # Leaf domain layers must not reach orchestration/adapters.
    ("fuelflow.topology", "fuelflow.engine"),
    ("fuelflow.entities", "fuelflow.engine"),
    ("fuelflow.resources", "fuelflow.engine"),
    ("fuelflow.physics", "fuelflow.engine"),
    ("fuelflow.constraints", "fuelflow.engine"),
    ("fuelflow.topology", "fuelflow.services"),
    ("fuelflow.entities", "fuelflow.services"),
    ("fuelflow.resources", "fuelflow.services"),
    ("fuelflow.physics", "fuelflow.services"),
    ("fuelflow.constraints", "fuelflow.services"),
    ("fuelflow.topology", "fuelflow.api"),
    ("fuelflow.entities", "fuelflow.api"),
    ("fuelflow.resources", "fuelflow.api"),
    ("fuelflow.physics", "fuelflow.api"),
    ("fuelflow.constraints", "fuelflow.api"),
    # Scenario layer should not import engine (fork is allowlisted).
    ("fuelflow.scenario", "fuelflow.engine"),
)


def is_known_violation(source_module: str, target_module: str) -> bool:
    for known in KNOWN_VIOLATIONS:
        if known.source_module == source_module and (
            target_module == known.target_module
            or target_module.startswith(f"{known.target_module}.")
        ):
            return True
    return False


def find_violations(edges: dict[str, list[str]]) -> list[tuple[str, str]]:
    violations: list[tuple[str, str]] = []
    for source_module, imports in sorted(edges.items()):
        for rule_source, forbidden_prefix in FORBIDDEN_RULES:
            if not _prefix_match(source_module, rule_source):
                continue
            for imported in imports:
                if _import_matches(imported, forbidden_prefix):
                    violations.append((source_module, imported))
    return sorted(set(violations))
