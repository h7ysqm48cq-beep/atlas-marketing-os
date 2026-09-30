from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.planner import PlannerResult

from .request import AIEngineerRequest


@dataclass(
    slots=True,
    kw_only=True,
)
class AIEngineerResult:
    request: AIEngineerRequest
    planner_result: PlannerResult | None = None
    error: str | None = None
    noop: bool = False
    completed: bool = False
    message: str | None = None

    @property
    def success(self) -> bool:
        if self.error is not None:
            return False

        if self.noop or self.completed:
            return True

        if self.planner_result is None:
            return False

        return self.planner_result.success

    @property
    def planned(self) -> bool:
        return self.planner_result is not None

    @property
    def executed(self) -> bool:
        if self.planner_result is None:
            return False

        return (
            self.planner_result.runtime_result
            is not None
        )

    @property
    def plan_id(self) -> str | None:
        if self.planner_result is None:
            return None

        return self.planner_result.plan.plan_id

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "success": self.success,
            "planned": self.planned,
            "executed": self.executed,
            "request": self.request.to_dict(),
            "error": self.error,
            "noop": self.noop,
            "completed": self.completed,
            "message": self.message,
        }

        if self.planner_result is None:
            payload["planner"] = None
            return payload

        planner_payload: dict[str, Any] = {
            "plan_id": (
                self.planner_result.plan.plan_id
            ),
            "plan_status": (
                self.planner_result
                .plan
                .status
                .value
            ),
            "action_count": len(
                self.planner_result.plan.actions
            ),
            "validation_failed": (
                self.planner_result
                .validation
                .has_failures
            ),
        }

        runtime_result = (
            self.planner_result.runtime_result
        )

        if runtime_result is not None:
            planner_payload[
                "runtime"
            ] = runtime_result.to_dict()
        else:
            planner_payload["runtime"] = None

        payload["planner"] = planner_payload
        return payload
