from __future__ import annotations

from tools.ir.action import (
    ActionStatus,
)
from tools.ir.plan import (
    ExecutionPlan,
    PlanStatus,
)
from tools.ir.registry import (
    ExecutorRegistry,
    ExecutorRegistryError,
)
from tools.ir.result import (
    ValidationDecision,
)
from tools.ir.validator import (
    ExecutionPlanValidator,
)

from .result import RuntimeResult


class AtlasRuntime:
    """
    Atlas Runtime v0.1.

    Lifecycle:

    ExecutionPlan
        -> Validation
        -> Executor dispatch
        -> Action status updates
        -> RuntimeResult
    """

    def __init__(
        self,
        *,
        validator: ExecutionPlanValidator,
        executors: ExecutorRegistry,
    ) -> None:
        self.validator = validator
        self.executors = executors

    def run(
        self,
        plan: ExecutionPlan,
    ) -> RuntimeResult:
        result = RuntimeResult(
            plan_id=plan.plan_id,
        )

        print("===== ATLAS RUNTIME =====")
        print("Plan:", plan.title)
        print()

        validation_report = self.validator.validate(
            plan,
        )
        result.validation_report = validation_report

        print("Validation results:")

        for validation in validation_report.results:
            print(
                f"- {validation.action_kind}: "
                f"{validation.decision.value}"
            )

        print()

        if validation_report.has_failures:
            self._apply_validation_failure(
                plan,
                validation_report,
                result,
            )

            result.success = False
            result.finish()
            return result

        plan.status = PlanStatus.EXECUTING

        actions_by_id = {
            action.action_id: action
            for action in plan.actions
        }

        for validation in validation_report.results:
            action = actions_by_id[
                validation.action_id
            ]

            if (
                validation.decision
                == ValidationDecision.SKIP
            ):
                action.status = ActionStatus.SKIPPED
                result.skipped += 1
                continue

            action.status = ActionStatus.VALIDATED

            try:
                executor = self.executors.resolve(
                    action,
                )
            except ExecutorRegistryError as exc:
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(str(exc))
                plan.status = PlanStatus.FAILED
                break

            try:
                action.status = ActionStatus.EXECUTING

                executor.execute(action)

                action.status = ActionStatus.DONE
                result.executed += 1

            except Exception as exc:
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(
                    f"{action.kind}: {exc}"
                )
                plan.status = PlanStatus.FAILED
                break

        if result.failed == 0:
            plan.status = PlanStatus.COMPLETED
            result.success = True
        else:
            plan.status = PlanStatus.FAILED
            result.success = False

        result.finish()
        return result

    @staticmethod
    def _apply_validation_failure(
        plan: ExecutionPlan,
        validation_report,
        result: RuntimeResult,
    ) -> None:
        actions_by_id = {
            action.action_id: action
            for action in plan.actions
        }

        for validation in validation_report.results:
            action = actions_by_id.get(
                validation.action_id,
            )

            if action is None:
                continue

            if (
                validation.decision
                == ValidationDecision.FAIL
            ):
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(
                    validation.message
                )

            elif (
                validation.decision
                == ValidationDecision.SKIP
            ):
                action.status = ActionStatus.SKIPPED
                result.skipped += 1

            else:
                action.status = ActionStatus.VALIDATED

        plan.status = PlanStatus.FAILED
