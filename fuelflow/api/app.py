"""FastAPI localhost backend."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from fuelflow.services import (
    ServiceError,
    load_schedule_file,
    load_scenario_file,
    run_fork,
    run_optimization,
    run_simulation,
    save_schedule,
    save_scenario,
    startup_cleanup,
    validate_scenario_file,
)

WORKSPACE = Path(os.environ.get("OPTIFUEL_WORKSPACE", ".")).resolve()
ALLOW_NON_LOOPBACK = os.environ.get("OPTIFUEL_ALLOW_NON_LOOPBACK", "0") == "1"


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup_cleanup(WORKSPACE)
    yield


app = FastAPI(title="OptiFuel API", version="0.1.0-alpha", lifespan=lifespan)

if ALLOW_NON_LOOPBACK:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


class SaveRequest(BaseModel):
    data: dict[str, Any]
    expected_digest: str | None = Field(default=None, alias="if_match")

    model_config = {"populate_by_name": True}


class SimulateRequest(BaseModel):
    scenario_path: str
    schedule_path: str
    runtime_mode: str = "fail_fast"


class OptimizeRequest(BaseModel):
    scenario_path: str
    seed: int = 42
    time_limit_sec: float = 5.0
    seed_schedule_path: str | None = None


class ForkRequest(BaseModel):
    scenario_path: str
    schedule_path: str
    state_at_min: float
    amendments: dict[str, Any]
    precedence: str | None = None
    output_path: str | None = None


def _handle_error(exc: Exception) -> None:
    if isinstance(exc, ServiceError):
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": str(exc)}) from exc
    raise exc


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "release": "v1-alpha"}


@app.get("/scenarios")
def list_scenarios() -> list[str]:
    examples = WORKSPACE / "examples"
    if not examples.exists():
        return []
    return [str(p.relative_to(WORKSPACE)) for p in examples.rglob("scenario.yaml")]


@app.get("/scenarios/{scenario_id:path}")
def get_scenario(scenario_id: str) -> dict[str, Any]:
    path = WORKSPACE / scenario_id
    try:
        scenario, digest_value = load_scenario_file(path, WORKSPACE)
    except Exception as exc:
        _handle_error(exc)
    return {
        "data": scenario.model_dump(by_alias=True),
        "digest": digest_value,
        "etag": digest_value,
    }


@app.put("/scenarios/{scenario_id:path}")
def put_scenario(
    scenario_id: str,
    body: SaveRequest,
    if_match: str | None = Header(default=None),
) -> dict[str, str]:
    path = WORKSPACE / scenario_id
    try:
        digest_value = save_scenario(
            path,
            body.data,
            WORKSPACE,
            expected_digest=if_match or body.expected_digest,
        )
    except Exception as exc:
        _handle_error(exc)
    return {"digest": digest_value, "etag": digest_value}


@app.post("/scenarios/{scenario_id:path}/validate")
def validate_scenario_endpoint(scenario_id: str) -> dict[str, Any]:
    path = WORKSPACE / scenario_id
    try:
        return validate_scenario_file(path, WORKSPACE)
    except Exception as exc:
        _handle_error(exc)


@app.get("/schedules/{schedule_id:path}")
def get_schedule(schedule_id: str) -> dict[str, Any]:
    path = WORKSPACE / schedule_id
    try:
        schedule, digest_value = load_schedule_file(path, WORKSPACE)
    except Exception as exc:
        _handle_error(exc)
    return {
        "data": schedule.model_dump(by_alias=True),
        "digest": digest_value,
        "etag": digest_value,
    }


@app.put("/schedules/{schedule_id:path}")
def put_schedule(
    schedule_id: str,
    body: SaveRequest,
    if_match: str | None = Header(default=None),
) -> dict[str, str]:
    path = WORKSPACE / schedule_id
    try:
        digest_value = save_schedule(
            path,
            body.data,
            WORKSPACE,
            expected_digest=if_match or body.expected_digest,
        )
    except Exception as exc:
        _handle_error(exc)
    return {"digest": digest_value, "etag": digest_value}


@app.post("/runs/simulate")
def simulate_endpoint(body: SimulateRequest) -> dict[str, Any]:
    try:
        return run_simulation(
            WORKSPACE / body.scenario_path,
            WORKSPACE / body.schedule_path,
            WORKSPACE,
            runtime_mode=body.runtime_mode,
        )
    except Exception as exc:
        _handle_error(exc)


@app.post("/runs/optimize")
def optimize_endpoint(body: OptimizeRequest) -> dict[str, Any]:
    try:
        return run_optimization(
            WORKSPACE / body.scenario_path,
            WORKSPACE,
            seed=body.seed,
            time_limit_sec=body.time_limit_sec,
            seed_schedule_path=WORKSPACE / body.seed_schedule_path if body.seed_schedule_path else None,
        )
    except Exception as exc:
        _handle_error(exc)


@app.post("/scenarios/fork")
def fork_endpoint(body: ForkRequest) -> dict[str, Any]:
    try:
        return run_fork(
            WORKSPACE / body.scenario_path,
            WORKSPACE / body.schedule_path,
            WORKSPACE,
            state_at_min=body.state_at_min,
            amendments=body.amendments,
            precedence=body.precedence,
            output_path=WORKSPACE / body.output_path if body.output_path else None,
        )
    except Exception as exc:
        _handle_error(exc)
