from __future__ import annotations

from typing import Any, TypeVar

from .action import Action


ActionType = TypeVar(
    "ActionType",
    bound=Action,
)


class ExecutorRegistryError(RuntimeError):
    pass


class ExecutorRegistry:
    """
    Maps an Atlas IR Action class to its executor.

    Executors are registered as classes or objects.
    Actual execution logic will be implemented in the next sprint.
    """

    def __init__(self) -> None:
        self._executors: dict[type[Action], Any] = {}

    def register(
        self,
        action_type: type[ActionType],
        executor: Any,
        *,
        replace: bool = False,
    ) -> None:
        if action_type in self._executors and not replace:
            raise ExecutorRegistryError(
                f"Executor already registered for "
                f"{action_type.__name__}"
            )

        self._executors[action_type] = executor

    def resolve(self, action: Action) -> Any:
        action_type = type(action)

        try:
            return self._executors[action_type]
        except KeyError as exc:
            raise ExecutorRegistryError(
                f"No executor registered for "
                f"{action_type.__name__}"
            ) from exc

    def contains(
        self,
        action_type: type[Action],
    ) -> bool:
        return action_type in self._executors

    def registered_actions(
        self,
    ) -> tuple[type[Action], ...]:
        return tuple(self._executors.keys())
