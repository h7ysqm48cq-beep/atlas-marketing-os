from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, TypeVar

from .action import Action
from .plan import ExecutionPlan
from .result import (
    ValidationDecision,
    ValidationResult,
    ValidationSeverity,
)


class ActionValidator(Protocol):
    def validate(
        self,
        action: Action,
        *,
        project_root: Path,
    ) -> ValidationResult:
        ...


ActionType = TypeVar(
    "ActionType",
    bound=Action,
)


class ValidatorRegistryError(RuntimeError):
    pass


class ValidatorRegistry:
    def __init__(self) -> None:
        self._validators: dict[
            type[Action],
            ActionValidator,
        ] = {}

    def register(
        self,
        action_type: type[ActionType],
        validator: ActionValidator,
        *,
        replace: bool = False,
    ) -> None:
        if action_type in self._validators and not replace:
            raise ValidatorRegistryError(
                f"Validator already registered for "
                f"{action_type.__name__}"
            )

        self._validators[action_type] = validator

    def resolve(
        self,
        action: Action,
    ) -> ActionValidator:
        action_type = type(action)

        try:
            return self._validators[action_type]
        except KeyError as exc:
            raise ValidatorRegistryError(
                f"No validator registered for "
                f"{action_type.__name__}"
            ) from exc

    def contains(
        self,
        action_type: type[Action],
    ) -> bool:
        return action_type in self._validators

    def registered_actions(
        self,
    ) -> tuple[type[Action], ...]:
        return tuple(self._validators.keys())


@dataclass(slots=True, kw_only=True)
class PlanValidationReport:
    plan_id: str
    results: list[ValidationResult] = field(
        default_factory=list,
    )

    @property
    def can_continue(self) -> bool:
        return all(
            result.can_continue
            for result in self.results
        )

    @property
    def has_failures(self) -> bool:
        return any(
            result.decision == ValidationDecision.FAIL
            for result in self.results
        )

    @property
    def executable_count(self) -> int:
        return sum(
            result.should_execute
            for result in self.results
        )

    @property
    def skipped_count(self) -> int:
        return sum(
            result.should_skip
            for result in self.results
        )

    @property
    def failed_count(self) -> int:
        return sum(
            result.decision == ValidationDecision.FAIL
            for result in self.results
        )


class ExecutionPlanValidator:
    def __init__(
        self,
        registry: ValidatorRegistry,
    ) -> None:
        self.registry = registry

    def validate(
        self,
        plan: ExecutionPlan,
    ) -> PlanValidationReport:
        project_root = Path(
            plan.target_project,
        ).resolve()

        report = PlanValidationReport(
            plan_id=plan.plan_id,
        )

        for action in plan.actions:
            try:
                validator = self.registry.resolve(action)
            except ValidatorRegistryError as exc:
                report.results.append(
                    ValidationResult(
                        action_id=action.action_id,
                        action_kind=action.kind,
                        decision=ValidationDecision.FAIL,
                        message=str(exc),
                        severity=ValidationSeverity.ERROR,
                        can_continue=False,
                    )
                )
                break

            result = validator.validate(
                action,
                project_root=project_root,
            )

            report.results.append(result)

            if not result.can_continue:
                break

        return report
