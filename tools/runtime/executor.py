from __future__ import annotations

from typing import Protocol

from tools.ir.action import Action


class ActionExecutor(Protocol):
    """
    Runtime executor contract.

    An executor performs one Atlas IR Action.
    """

    def execute(
        self,
        action: Action,
    ) -> None:
        ...
