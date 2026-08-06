from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import perf_counter
from typing import Any

from tools.ir.validator import PlanValidationReport


@dataclass(slots=True, kw_only=True)
class ActionRuntimeRecord:
    action_id: str
    action_kind: str
    status: str
    changed: bool = False
    saved: bool = False
    preview: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True, kw_only=True)
class RuntimeResult:
    plan_id: str
    success: bool = False
    dry_run: bool = False
    rolled_back: bool = False
    executed: int = 0
    skipped: int = 0
    failed: int = 0
    validation_report: PlanValidationReport | None = None
    records: list[ActionRuntimeRecord] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=perf_counter)
    finished_at: float | None = None

    def finish(self) -> None:
        self.finished_at = perf_counter()

    @property
    def duration_ms(self) -> float:
        if self.finished_at is None:
            return 0.0
        return (self.finished_at - self.started_at) * 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "success": self.success,
            "dry_run": self.dry_run,
            "rolled_back": self.rolled_back,
            "executed": self.executed,
            "skipped": self.skipped,
            "failed": self.failed,
            "records": [record.to_dict() for record in self.records],
            "errors": list(self.errors),
            "duration_ms": round(self.duration_ms, 3),
        }
