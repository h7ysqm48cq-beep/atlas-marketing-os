from __future__ import annotations

from tools.ir.action import Action


class MockExecutor:
    """
    Test executor used to validate Runtime orchestration.

    It does not modify files.
    """

    def execute(
        self,
        action: Action,
    ) -> None:
        print(
            f"EXECUTE -> {action.kind}"
        )
