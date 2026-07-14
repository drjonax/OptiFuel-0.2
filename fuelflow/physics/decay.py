"""Physics layer: decay model and core exit states."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DecayTableEntry(BaseModel):
    time_min: float
    heat_kw: float


class CoreExitState(BaseModel):
    entity_id: str
    cycle: int
    burnup_mwd_kgu: float
    discharge_time_min: float


class DecayModel(BaseModel):
    """Tabulated decay lookup with deterministic interpolation."""

    entity_id: str
    table: list[DecayTableEntry] = Field(default_factory=list)

    def heat_kw(self, t_min: float) -> float:
        if not self.table:
            return 0.0
        sorted_table = sorted(self.table, key=lambda e: e.time_min)
        if t_min <= sorted_table[0].time_min:
            return sorted_table[0].heat_kw
        prev = sorted_table[0]
        for entry in sorted_table[1:]:
            if t_min <= entry.time_min:
                span = entry.time_min - prev.time_min
                if span <= 0:
                    return entry.heat_kw
                ratio = (t_min - prev.time_min) / span
                return round(prev.heat_kw + ratio * (entry.heat_kw - prev.heat_kw), 10)
            prev = entry
        return sorted_table[-1].heat_kw


class PhysicsConfig(BaseModel):
    decay_models: list[DecayModel] = Field(default_factory=list)
    core_exit_states: list[CoreExitState] = Field(default_factory=list)

    def decay_for(self, entity_id: str) -> DecayModel | None:
        for model in self.decay_models:
            if model.entity_id == entity_id:
                return model
        return None
