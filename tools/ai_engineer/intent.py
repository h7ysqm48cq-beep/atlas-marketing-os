from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class IntentType(str, Enum):
    RENAME_SYMBOL = "rename_symbol"
    CREATE_CRUD = "create_crud"
    CONNECT_DEPENDENCY = "connect_dependency"
    REGISTER_MODULE_IMPORT = (
        "register_module_import"
    )
    REDESIGN_UI = "redesign_ui"
    INVESTIGATE_AND_FIX = (
        "investigate_and_fix"
    )
    UNKNOWN = "unknown"


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class EngineeringIntent:
    intent_type: IntentType
    raw_text: str

    target: str | None = None
    arguments: dict[str, Any] = field(
        default_factory=dict,
    )

    confidence: float = 0.0
    requires_review: bool = False
    reason: str | None = None

    @property
    def actionable(self) -> bool:
        return self.intent_type in {
            IntentType.RENAME_SYMBOL,
            IntentType.CREATE_CRUD,
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_type": (
                self.intent_type.value
            ),
            "raw_text": self.raw_text,
            "target": self.target,
            "arguments": dict(
                self.arguments
            ),
            "confidence": self.confidence,
            "requires_review": (
                self.requires_review
            ),
            "reason": self.reason,
            "actionable": self.actionable,
        }
