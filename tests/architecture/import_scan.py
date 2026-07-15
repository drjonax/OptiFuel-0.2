"""AST-based import scanner for fuelflow modules."""

from __future__ import annotations

import ast
from pathlib import Path


def module_path_to_name(path: Path, package_root: Path) -> str:
    rel = path.relative_to(package_root)
    parts = list(rel.parts)
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    else:
        parts[-1] = parts[-1].removesuffix(".py")
    return ".".join(parts)


def iter_fuelflow_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("fuelflow"):
                    imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.startswith("fuelflow"):
                imports.append(node.module)
    return sorted(set(imports))


def scan_package(package_root: Path) -> dict[str, list[str]]:
    edges: dict[str, list[str]] = {}
    for path in sorted(package_root.rglob("*.py")):
        if path.name.startswith("."):
            continue
        module = module_path_to_name(path, package_root)
        edges[module] = iter_fuelflow_imports(path)
    return edges
