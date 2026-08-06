from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RUNTIME_PY = '''from __future__ import annotations

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
    def _action_target(action: Action) -> str | None:
        value = getattr(action, "file_path", None)
        if not isinstance(value, str):
            return None
        value = value.strip()
        return value or None

    @classmethod
    def _snapshot_targets(
        cls,
        plan: ExecutionPlan,
    ) -> dict[Path, bytes | None]:
        root = Path(plan.target_project).resolve()
        snapshots: dict[Path, bytes | None] = {}

        for action in plan.actions:
            relative = cls._action_target(action)
            if relative is None:
                continue

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
'''

RESULT_PY = '''from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import perf_counter
from typing import Any

from tools.ir.validator import PlanValidationReport


@dataclass(slots=True, kw_only=True)
class ActionRuntimeRecord:
    action_id: str
    action_kind: str
    status: str
    changed: bool = False
    saved: bool = False
    preview: str = ""
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True, kw_only=True)
class RuntimeResult:
    plan_id: str
    success: bool = False
    dry_run: bool = False
    rolled_back: bool = False
    executed: int = 0
    skipped: int = 0
    failed: int = 0
    validation_report: PlanValidationReport | None = None
    records: list[ActionRuntimeRecord] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    started_at: float = field(default_factory=perf_counter)
    finished_at: float | None = None

    def finish(self) -> None:
        self.finished_at = perf_counter()

    @property
    def duration_ms(self) -> float:
        if self.finished_at is None:
            return 0.0
        return (self.finished_at - self.started_at) * 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "success": self.success,
            "dry_run": self.dry_run,
            "rolled_back": self.rolled_back,
            "executed": self.executed,
            "skipped": self.skipped,
            "failed": self.failed,
            "records": [record.to_dict() for record in self.records],
            "errors": list(self.errors),
            "duration_ms": round(self.duration_ms, 3),
        }
'''

EXECUTOR_PY = '''from __future__ import annotations

from typing import Any, Protocol

from tools.ir.action import Action


class ActionExecutor(Protocol):
    def execute(
        self,
        action: Action,
    ) -> Any:
        ...
'''

TEST_PY = '''from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import ActionStatus, AddImport
from tools.ir.plan import ExecutionPlan, PlanStatus
from tools.ir.registry import ExecutorRegistry
from tools.ir.result import ValidationDecision, ValidationResult, ValidationSeverity
from tools.ir.validator import PlanValidationReport
from tools.runtime.runtime import AtlasRuntime


class PassingValidator:
    def validate(self, plan):
        return PlanValidationReport(
            plan_id=plan.plan_id,
            results=[
                ValidationResult(
                    action_id=action.action_id,
                    action_kind=action.kind,
                    decision=ValidationDecision.PASS,
                    message="ok",
                    severity=ValidationSeverity.INFO,
                    can_continue=True,
                )
                for action in plan.actions
            ],
        )


@dataclass
class FakeResult:
    changed: bool
    saved: bool
    preview: str


class WritingExecutor:
    def __init__(self):
        self.dry_run = False
        self.last_result = None

    def execute(self, action):
        path = Path(action.file_path)
        updated = path.read_text(encoding="utf-8") + "\\nchanged"
        if not self.dry_run:
            path.write_text(updated, encoding="utf-8")
        self.last_result = FakeResult(
            changed=True,
            saved=not self.dry_run,
            preview="preview",
        )


class FailingExecutor:
    dry_run = False

    def execute(self, action):
        raise RuntimeError("boom")


def build_runtime(executor):
    registry = ExecutorRegistry()
    registry.register(AddImport, executor)
    return AtlasRuntime(
        validator=PassingValidator(),
        executors=registry,
    )


def test_dry_run_does_not_write(tmp_path):
    target = tmp_path / "app.ts"
    target.write_text("const value = 1;", encoding="utf-8")
    action = AddImport(
        file_path=str(target),
        symbol="Logger",
        module="@nestjs/common",
    )
    plan = ExecutionPlan(
        title="dry run",
        target_project=str(tmp_path),
        actions=[action],
    )

    result = build_runtime(WritingExecutor()).run(plan, dry_run=True)

    assert result.success
    assert result.dry_run
    assert target.read_text(encoding="utf-8") == "const value = 1;"
    assert result.records[0].changed
    assert not result.records[0].saved


def test_failure_rolls_back_previous_write(tmp_path):
    first = tmp_path / "first.ts"
    second = tmp_path / "second.ts"
    first.write_text("first", encoding="utf-8")
    second.write_text("second", encoding="utf-8")

    first_action = AddImport(
        file_path=str(first),
        symbol="One",
        module="./one",
    )
    second_action = AddImport(
        file_path=str(second),
        symbol="Two",
        module="./two",
    )

    class RoutedRegistry:
        def __init__(self):
            self.calls = 0
            self.writer = WritingExecutor()
            self.failure = FailingExecutor()

        def resolve(self, action):
            self.calls += 1
            return self.writer if self.calls == 1 else self.failure

    runtime = AtlasRuntime(
        validator=PassingValidator(),
        executors=RoutedRegistry(),
    )
    plan = ExecutionPlan(
        title="rollback",
        target_project=str(tmp_path),
        actions=[first_action, second_action],
    )

    result = runtime.run(plan)

    assert not result.success
    assert result.rolled_back
    assert plan.status == PlanStatus.ROLLED_BACK
    assert first.read_text(encoding="utf-8") == "first"
    assert second.read_text(encoding="utf-8") == "second"
    assert first_action.status == ActionStatus.DONE
    assert second_action.status == ActionStatus.FAILED
'''


def write_file(root: Path, relative: str, content: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()
    required = [
        root / "tools/runtime/runtime.py",
        root / "tools/runtime/result.py",
        root / "tools/runtime/executor.py",
        root / "tools/ir/action.py",
        root / "tools/ir/plan.py",
    ]

    missing = [str(path) for path in required if not path.exists()]
    if missing:
        print("Missing required files:")
        for path in missing:
            print("-", path)
        return 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_root = root / ".atlas" / "backups" / "patch_011a" / stamp
    targets = [
        "tools/runtime/runtime.py",
        "tools/runtime/result.py",
        "tools/runtime/executor.py",
        "tools/tests/test_runtime_transaction.py",
    ]

    for relative in targets:
        source = root / relative
        if source.exists():
            destination = backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    try:
        write_file(root, "tools/runtime/runtime.py", RUNTIME_PY)
        write_file(root, "tools/runtime/result.py", RESULT_PY)
        write_file(root, "tools/runtime/executor.py", EXECUTOR_PY)
        write_file(root, "tools/tests/test_runtime_transaction.py", TEST_PY)

        if not compileall.compile_dir(str(root / "tools"), quiet=1):
            raise RuntimeError("Python compile failed")

        if not args.skip_tests:
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "tools/tests/test_runtime_transaction.py",
                ],
                cwd=root,
                check=True,
            )

        report = root / ".atlas" / "reports" / "patch011a-runtime.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                {
                    "patch": "011A",
                    "status": "completed",
                    "backup": str(backup_root),
                    "files": targets,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        print("Patch011A Runtime Completion: PASS")
        print("Report:", report)
        return 0

    except Exception as exc:
        print("Patch failed:", exc)
        print("Restoring backup...")

        for relative in targets:
            backup = backup_root / relative
            target = root / relative
            if backup.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, target)
            elif target.exists():
                target.unlink()

        print("Rollback complete.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
