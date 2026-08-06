from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

from tools.ir.validator import PlanValidationReport


@dataclass(slots=True, kw_only=True)
class RuntimeResult:
    plan_id: str
    success: bool = False

    executed: int = 0
    skipped: int = 0
    failed: int = 0

    validation_report: PlanValidationReport | None = None
    errors: list[str] = field(default_factory=list)

    started_at: float = field(
        default_factory=perf_counter,
    )
    finished_at: float | None = None

    def finish(self) -> None:
        self.finished_at = perf_counter()

    @property
    def duration_ms(self) -> float:
        if self.finished_at is None:
            return 0.0

        return (
            self.finished_at
            - self.started_at
        ) * 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "success": self.success,
            "executed": self.executed,
            "skipped": self.skipped,
            "failed": self.failed,
            "errors": list(self.errors),
            "duration_ms": round(
                self.duration_ms,
                3,
            ),
        }
