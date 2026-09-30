from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tools.ir.plan import ExecutionPlan
from tools.ir.resolver import (
    TaskResolutionEngine,
    TaskResolverRegistry,
)
from tools.ir.task import Task
from tools.ir.templates import (
    register_default_task_resolvers,
)
from tools.ir.validator import (
    ExecutionPlanValidator,
    PlanValidationReport,
    ValidatorRegistry,
)
from tools.ir.basic_validators import (
    register_basic_validators,
)


class PlannerError(RuntimeError):
    """Raised when Atlas cannot plan, validate, or execute a task."""


@dataclass(slots=True, kw_only=True)
class PlannerResult:
    task: Task
    plan: ExecutionPlan
    validation: PlanValidationReport
    runtime_result: Any | None = None

    @property
    def valid(self) -> bool:
        return not self.validation.has_failures

    @property
    def executed(self) -> bool:
        return self.runtime_result is not None

    @property
    def success(self) -> bool:
        if not self.valid:
            return False

        if self.runtime_result is None:
            return True

        return bool(
            getattr(
                self.runtime_result,
                "success",
                False,
            )
        )

    def to_dict(self) -> dict[str, Any]:
        runtime_payload = None

        if self.runtime_result is not None:
            converter = getattr(
                self.runtime_result,
                "to_dict",
                None,
            )
            runtime_payload = (
                converter()
                if callable(converter)
                else self.runtime_result
            )

        return {
            "task": self.task.to_dict(),
            "plan": self.plan.to_dict(),
            "validation": {
                "can_continue": (
                    self.validation.can_continue
                ),
                "has_failures": (
                    self.validation.has_failures
                ),
                "executable_count": (
                    self.validation.executable_count
                ),
                "skipped_count": (
                    self.validation.skipped_count
                ),
                "failed_count": (
                    self.validation.failed_count
                ),
            },
            "runtime": runtime_payload,
            "success": self.success,
        }


class AtlasPlanner:
    """
    High-level Atlas planning facade.

    It converts a Task into an ExecutionPlan, validates the plan,
    and can optionally pass the validated plan to AtlasRuntime.
    """

    def __init__(
        self,
        *,
        resolver: TaskResolutionEngine,
        validator: ExecutionPlanValidator,
        runtime: Any | None = None,
    ) -> None:
        self.resolver = resolver
        self.validator = validator
        self.runtime = runtime

    def create_plan(
        self,
        task: Task,
        *,
        planner: str = "atlas-planner",
        target_project: str = ".",
    ) -> ExecutionPlan:
        if not isinstance(task, Task):
            raise TypeError(
                "task must be an Atlas Task"
            )

        return self.resolver.resolve(
            task,
            planner=planner,
            target_project=target_project,
        )

    def validate_plan(
        self,
        plan: ExecutionPlan,
    ) -> PlanValidationReport:
        if not isinstance(plan, ExecutionPlan):
            raise TypeError(
                "plan must be an ExecutionPlan"
            )

        return self.validator.validate(plan)

    def plan_and_validate(
        self,
        task: Task,
        *,
        planner: str = "atlas-planner",
        target_project: str = ".",
    ) -> PlannerResult:
        plan = self.create_plan(
            task,
            planner=planner,
            target_project=target_project,
        )
        validation = self.validate_plan(plan)

        return PlannerResult(
            task=task,
            plan=plan,
            validation=validation,
        )

    def execute(
        self,
        task: Task,
        *,
        planner: str = "atlas-planner",
        target_project: str = ".",
        dry_run: bool = False,
        rollback_on_failure: bool = True,
    ) -> PlannerResult:
        result = self.plan_and_validate(
            task,
            planner=planner,
            target_project=target_project,
        )

        if result.validation.has_failures:
            return result

        if self.runtime is None:
            raise PlannerError(
                "Planner runtime is not configured"
            )

        runtime_result = self.runtime.run(
            result.plan,
            dry_run=dry_run,
            rollback_on_failure=(
                rollback_on_failure
            ),
        )

        result.runtime_result = runtime_result
        return result


def build_default_planner(
    *,
    runtime: Any | None = None,
) -> AtlasPlanner:
    resolver_registry = TaskResolverRegistry()
    register_default_task_resolvers(
        resolver_registry
    )

    validator_registry = ValidatorRegistry()
    register_basic_validators(
        validator_registry
    )

    return AtlasPlanner(
        resolver=TaskResolutionEngine(
            resolver_registry
        ),
        validator=ExecutionPlanValidator(
            validator_registry
        ),
        runtime=runtime,
    )
