from __future__ import annotations

from pathlib import Path
from typing import Any

from tools.ir.action import Action, ActionStatus
from tools.ir.plan import ExecutionPlan, PlanStatus
from tools.ir.registry import ExecutorRegistry, ExecutorRegistryError
from tools.ir.result import ValidationDecision
from tools.ir.validator import ExecutionPlanValidator

from .result import ActionRuntimeRecord, RuntimeResult


class AtlasRuntime:
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
        *,
        dry_run: bool = False,
        rollback_on_failure: bool = True,
    ) -> RuntimeResult:
        if not isinstance(plan, ExecutionPlan):
            raise TypeError("plan must be an ExecutionPlan")
        if not isinstance(dry_run, bool):
            raise TypeError("dry_run must be a boolean")
        if not isinstance(rollback_on_failure, bool):
            raise TypeError("rollback_on_failure must be a boolean")

        result = RuntimeResult(
            plan_id=plan.plan_id,
            dry_run=dry_run,
        )

        validation_report = self.validator.validate(plan)
        result.validation_report = validation_report

        if validation_report.has_failures:
            self._apply_validation_failure(
                plan,
                validation_report,
                result,
            )
            result.finish()
            return result

        snapshots = self._snapshot_targets(plan)
        plan.status = PlanStatus.EXECUTING

        actions_by_id = {
            action.action_id: action
            for action in plan.actions
        }

        for validation in validation_report.results:
            action = actions_by_id[validation.action_id]

            if validation.decision == ValidationDecision.SKIP:
                action.status = ActionStatus.SKIPPED
                result.skipped += 1
                result.records.append(
                    ActionRuntimeRecord(
                        action_id=action.action_id,
                        action_kind=action.kind,
                        status=ActionStatus.SKIPPED.value,
                    )
                )
                continue

            action.status = ActionStatus.VALIDATED

            try:
                executor = self.executors.resolve(action)
            except ExecutorRegistryError as exc:
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(str(exc))
                result.records.append(
                    ActionRuntimeRecord(
                        action_id=action.action_id,
                        action_kind=action.kind,
                        status=ActionStatus.FAILED.value,
                        error=str(exc),
                    )
                )
                break

            previous_dry_run = getattr(executor, "dry_run", None)
            if hasattr(executor, "dry_run"):
                executor.dry_run = dry_run

            try:
                action.status = ActionStatus.EXECUTING
                returned = executor.execute(action)
                action.status = ActionStatus.DONE
                result.executed += 1

                executor_result = getattr(
                    executor,
                    "last_result",
                    returned,
                )
                result.records.append(
                    self._record_for_success(
                        action,
                        executor_result,
                    )
                )
            except Exception as exc:
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(f"{action.kind}: {exc}")
                result.records.append(
                    ActionRuntimeRecord(
                        action_id=action.action_id,
                        action_kind=action.kind,
                        status=ActionStatus.FAILED.value,
                        error=str(exc),
                    )
                )
                break
            finally:
                if previous_dry_run is not None and hasattr(executor, "dry_run"):
                    executor.dry_run = previous_dry_run

        if result.failed == 0:
            plan.status = PlanStatus.COMPLETED
            result.success = True
        else:
            plan.status = PlanStatus.FAILED
            if rollback_on_failure and not dry_run:
                result.rolled_back = self._restore_snapshots(snapshots)
                if result.rolled_back:
                    plan.status = PlanStatus.ROLLED_BACK

        result.finish()
        return result

    @staticmethod
    def _action_targets(
        action: Action,
    ) -> tuple[str, ...]:
        files = getattr(
            action,
            "files",
            None,
        )

        if files is not None:
            targets: list[str] = []

            for file_edit in files:
                value = getattr(
                    file_edit,
                    "file_path",
                    None,
                )

                if not isinstance(
                    value,
                    str,
                ):
                    continue

                normalized = value.strip()

                if normalized:
                    targets.append(
                        normalized
                    )

            return tuple(targets)

        value = getattr(
            action,
            "file_path",
            None,
        )

        if not isinstance(value, str):
            return ()

        normalized = value.strip()

        if not normalized:
            return ()

        return (normalized,)

    @classmethod
    def _snapshot_targets(
        cls,
        plan: ExecutionPlan,
    ) -> dict[Path, bytes | None]:
        root = Path(plan.target_project).resolve()
        snapshots: dict[Path, bytes | None] = {}

        for action in plan.actions:
            for relative in cls._action_targets(
                action
            ):
                target = Path(relative)

                if not target.is_absolute():
                    target = root / target

                target = target.resolve()
                target.relative_to(root)

                if target not in snapshots:
                    snapshots[target] = (
                        target.read_bytes()
                        if target.exists()
                        else None
                    )

        return snapshots

    @staticmethod
    def _restore_snapshots(
        snapshots: dict[Path, bytes | None],
    ) -> bool:
        if not snapshots:
            return False

        for target, content in snapshots.items():
            if content is None:
                if target.exists():
                    target.unlink()
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)

        return True

    @staticmethod
    def _record_for_success(
        action: Action,
        executor_result: Any,
    ) -> ActionRuntimeRecord:
        return ActionRuntimeRecord(
            action_id=action.action_id,
            action_kind=action.kind,
            status=ActionStatus.DONE.value,
            changed=bool(getattr(executor_result, "changed", False)),
            saved=bool(getattr(executor_result, "saved", False)),
            preview=getattr(executor_result, "preview", "") or "",
        )

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
            action = actions_by_id.get(validation.action_id)
            if action is None:
                continue

            if validation.decision == ValidationDecision.FAIL:
                action.status = ActionStatus.FAILED
                result.failed += 1
                result.errors.append(validation.message)
            elif validation.decision == ValidationDecision.SKIP:
                action.status = ActionStatus.SKIPPED
                result.skipped += 1
            else:
                action.status = ActionStatus.VALIDATED

        plan.status = PlanStatus.FAILED
