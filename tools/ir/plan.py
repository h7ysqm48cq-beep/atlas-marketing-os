from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable
from uuid import uuid4

from .action import Action, ActionStatus


class PlanStatus(str, Enum):
    DRAFT = "draft"
    READY = "ready"
    EXECUTING = "executing"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


@dataclass(slots=True, kw_only=True)
class ExecutionPlan:
    title: str
    description: str = ""
    planner: str = "human"
    target_project: str = "."
    actions: list[Action] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    plan_id: str = field(
        default_factory=lambda: uuid4().hex,
    )
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc),
    )
    status: PlanStatus = PlanStatus.DRAFT

    def add(self, action: Action) -> Action:
        self.actions.append(action)
        return action

    def extend(self, actions: Iterable[Action]) -> None:
        self.actions.extend(actions)

    def pending_actions(self) -> list[Action]:
        return [
            action
            for action in self.actions
            if action.status == ActionStatus.PENDING
        ]

    def mark_ready(self) -> None:
        self.status = PlanStatus.READY

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["created_at"] = self.created_at.isoformat()
        data["status"] = self.status.value
        data["actions"] = [
            action.to_dict()
            for action in self.actions
        ]
        return data
