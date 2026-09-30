from __future__ import annotations

from .action import (
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
)
from .plan import ExecutionPlan
from .resolver import TaskResolverRegistry
from .task import (
    ConnectServiceTask,
    RegisterModuleImportTask,
    Task,
)


class ConnectServiceTaskResolver:
    """
    Expands ConnectServiceTask into:

    1. AddImport
    2. AddConstructorParameter
    """

    def resolve(
        self,
        task: Task,
        *,
        planner: str = "task-resolver",
        target_project: str = ".",
    ) -> ExecutionPlan:
        if not isinstance(task, ConnectServiceTask):
            raise TypeError(
                "ConnectServiceTaskResolver received "
                f"{type(task).__name__}"
            )

        plan = ExecutionPlan(
            title=(
                f"Connect {task.dependency_type} "
                f"to {task.target_class}"
            ),
            description=(
                f"Import and inject {task.dependency_type} "
                f"into {task.target_class}."
            ),
            planner=planner,
            target_project=target_project,
            metadata={
                "source_task_id": task.task_id,
                "source_task_kind": task.kind,
                **task.metadata,
            },
        )

        plan.add(
            AddImport(
                file_path=task.target_file,
                symbol=task.dependency_type,
                module=task.dependency_import,
            )
        )

        plan.add(
            AddConstructorParameter(
                file_path=task.target_file,
                class_name=task.target_class,
                parameter_name=task.dependency_name,
                parameter_type=task.dependency_type,
                modifiers=task.modifiers,
                import_module=task.dependency_import,
            )
        )

        plan.mark_ready()

        return plan


class RegisterModuleImportTaskResolver:
    """
    Expands RegisterModuleImportTask into:

    1. AddImport
    2. AddModuleImport
    """

    def resolve(
        self,
        task: Task,
        *,
        planner: str = "task-resolver",
        target_project: str = ".",
    ) -> ExecutionPlan:
        if not isinstance(task, RegisterModuleImportTask):
            raise TypeError(
                "RegisterModuleImportTaskResolver received "
                f"{type(task).__name__}"
            )

        plan = ExecutionPlan(
            title=(
                f"Register {task.module_class}"
            ),
            description=(
                f"Import and register {task.module_class} "
                f"inside the NestJS module."
            ),
            planner=planner,
            target_project=target_project,
            metadata={
                "source_task_id": task.task_id,
                "source_task_kind": task.kind,
                **task.metadata,
            },
        )

        plan.add(
            AddImport(
                file_path=task.target_file,
                symbol=task.module_class,
                module=task.module_import,
            )
        )

        plan.add(
            AddModuleImport(
                file_path=task.target_file,
                module_class=task.module_class,
                import_module=task.module_import,
            )
        )

        plan.mark_ready()

        return plan


def register_default_task_resolvers(
    registry: TaskResolverRegistry,
) -> None:
    registry.register(
        ConnectServiceTask,
        ConnectServiceTaskResolver(),
    )

    registry.register(
        RegisterModuleImportTask,
        RegisterModuleImportTaskResolver(),
    )
