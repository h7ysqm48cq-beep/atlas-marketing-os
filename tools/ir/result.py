from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any


class ValidationSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class ValidationDecision(str, Enum):
    PASS = "pass"
    SKIP = "skip"
    FAIL = "fail"


@dataclass(slots=True, kw_only=True)
class ValidationResult:
    action_id: str
    action_kind: str
    decision: ValidationDecision
    message: str
    severity: ValidationSeverity = ValidationSeverity.INFO
    can_continue: bool = True

    @property
    def valid(self) -> bool:
        return self.decision != ValidationDecision.FAIL

    @property
    def should_execute(self) -> bool:
        return self.decision == ValidationDecision.PASS

    @property
    def should_skip(self) -> bool:
        return self.decision == ValidationDecision.SKIP

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["decision"] = self.decision.value
        data["severity"] = self.severity.value
        data["valid"] = self.valid
        data["should_execute"] = self.should_execute
        data["should_skip"] = self.should_skip
        return data
