"""OptiFuel CLI."""

from __future__ import annotations

import json
import os
from pathlib import Path

import typer
import uvicorn

from fuelflow.services import (
    ServiceError,
    run_fork,
    run_optimization,
    run_simulation,
    validate_scenario_file,
)

app = typer.Typer(no_args_is_help=True)
WORKSPACE = Path(os.environ.get("OPTIFUEL_WORKSPACE", ".")).resolve()


def _print_error(exc: ServiceError) -> None:
    typer.echo(json.dumps({"code": exc.code, "message": str(exc)}), err=True)
    raise typer.Exit(code=1)


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    if host not in {"127.0.0.1", "localhost"} and os.environ.get("OPTIFUEL_ALLOW_NON_LOOPBACK", "0") != "1":
        typer.echo("Non-loopback bind rejected. Set OPTIFUEL_ALLOW_NON_LOOPBACK=1 to override.", err=True)
        raise typer.Exit(1)
    uvicorn.run("fuelflow.api.app:app", host=host, port=port, reload=False)


@app.command()
def validate(scenario_path: Path) -> None:
    try:
        result = validate_scenario_file(scenario_path, WORKSPACE)
    except ServiceError as exc:
        _print_error(exc)
    typer.echo(json.dumps(result, indent=2))


@app.command()
def simulate(
    scenario_path: Path,
    schedule_path: Path,
    runtime_mode: str = "fail_fast",
) -> None:
    try:
        result = run_simulation(scenario_path, schedule_path, WORKSPACE, runtime_mode=runtime_mode)
    except ServiceError as exc:
        _print_error(exc)
    typer.echo(json.dumps(result, indent=2))


@app.command()
def optimize(
    scenario_path: Path,
    seed: int = 42,
    time_limit_sec: float = 5.0,
    seed_schedule_path: Path | None = None,
) -> None:
    try:
        result = run_optimization(
            scenario_path,
            WORKSPACE,
            seed=seed,
            time_limit_sec=time_limit_sec,
            seed_schedule_path=seed_schedule_path,
        )
    except ServiceError as exc:
        _print_error(exc)
    typer.echo(json.dumps(result, indent=2))


@app.command("fork")
def fork_cmd(
    scenario_path: Path,
    schedule_path: Path,
    state_at_min: float,
    amendments_json: str = "{}",
    precedence: str | None = None,
    output_path: Path | None = None,
    if_match: str | None = None,
) -> None:
    amendments = json.loads(amendments_json)
    if if_match:
        amendments.setdefault("_if_match", if_match)
    try:
        result = run_fork(
            scenario_path,
            schedule_path,
            WORKSPACE,
            state_at_min=state_at_min,
            amendments=amendments,
            precedence=precedence,
            output_path=output_path,
        )
    except ServiceError as exc:
        _print_error(exc)
    typer.echo(json.dumps(result, indent=2))


@app.command()
def benchmark(scenario_path: Path, schedule_path: Path | None = None) -> None:
    import platform
    import sys
    import time

    started = time.perf_counter()
    if schedule_path:
        result = run_simulation(scenario_path, schedule_path, WORKSPACE)
        mode = "simulate"
    else:
        result = run_optimization(scenario_path, WORKSPACE)
        mode = "optimize"
    elapsed = time.perf_counter() - started

    report = {
        "scenario_path": str(scenario_path),
        "mode": mode,
        "elapsed_sec": round(elapsed, 6),
        "python_version": sys.version,
        "platform": platform.platform(),
        "runtime_mode": "fail_fast",
        "determinism_flags": {"seed": 42, "workers": 1},
        "result_summary": {
            "outcome": result.get("outcome", "completed"),
            "failed": result.get("manifest", {}).get("failed") if mode == "simulate" else None,
        },
    }
    typer.echo(json.dumps(report, indent=2))
