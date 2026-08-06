from __future__ import annotations

from typing import Any, Protocol

from tools.ir.action import Action


class ActionExecutor(Protocol):
    def execute(
        self,
        action: Action,
    ) -> Any:
        ...
