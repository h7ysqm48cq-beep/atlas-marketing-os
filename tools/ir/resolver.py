from __future__ import annotations

from typing import Protocol, TypeVar

from .plan import ExecutionPlan
from .task import Task


class TaskResolver(Protocol):
    def resolve(
        self,
        task: Task,
        *,
        planner: str = "task-resolver",
        target_project: str = ".",
    ) -> ExecutionPlan:
        ...


TaskType = TypeVar(
    "TaskType",
    bound=Task,
)


class TaskResolverRegistryError(RuntimeError):
    pass


class TaskResolverRegistry:
    """
    Maps a high-level Task type to its resolver.
    """

    def __init__(self) -> None:
        self._resolvers: dict[
            type[Task],
            TaskResolver,
        ] = {}

    def register(
        self,
        task_type: type[TaskType],
        resolver: TaskResolver,
        *,
        replace: bool = False,
    ) -> None:
        if task_type in self._resolvers and not replace:
            raise TaskResolverRegistryError(
                f"Resolver already registered for "
                f"{task_type.__name__}"
            )

        self._resolvers[task_type] = resolver

    def resolve(
        self,
        task: Task,
    ) -> TaskResolver:
        task_type = type(task)

        try:
            return self._resolvers[task_type]
        except KeyError as exc:
            raise TaskResolverRegistryError(
                f"No resolver registered for "
                f"{task_type.__name__}"
            ) from exc

    def contains(
        self,
        task_type: type[Task],
    ) -> bool:
        return task_type in self._resolvers

    def registered_tasks(
        self,
    ) -> tuple[type[Task], ...]:
        return tuple(self._resolvers.keys())


class TaskResolutionEngine:
    """
    Converts high-level Tasks into Atlas ExecutionPlans.
    """

    def __init__(
        self,
        registry: TaskResolverRegistry,
    ) -> None:
        self.registry = registry

    def resolve(
        self,
        task: Task,
        *,
        planner: str = "task-resolver",
        target_project: str = ".",
    ) -> ExecutionPlan:
        resolver = self.registry.resolve(task)

        return resolver.resolve(
            task,
            planner=planner,
            target_project=target_project,
        )
