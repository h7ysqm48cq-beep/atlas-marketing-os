from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


PLANNER_INIT = '''from .planner import (
    AtlasPlanner,
    PlannerError,
    PlannerResult,
    build_default_planner,
)

__all__ = [
    "AtlasPlanner",
    "PlannerError",
    "PlannerResult",
    "build_default_planner",
]
'''


PLANNER_PY = '''from __future__ import annotations

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
'''


TEST_PY = '''from __future__ import annotations

from tools.ir.action import (
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
)
from tools.ir.plan import PlanStatus
from tools.ir.task import (
    ConnectServiceTask,
    RegisterModuleImportTask,
)
from tools.planner import (
    PlannerError,
    build_default_planner,
)


def test_connect_service_task_builds_valid_plan(
    tmp_path,
):
    target = tmp_path / "app.service.ts"
    target.write_text(
        "export class AppService {}\\\\n",
        encoding="utf-8",
    )

    task = ConnectServiceTask(
        target_file="app.service.ts",
        target_class="AppService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert result.valid
    assert result.success
    assert result.plan.status == PlanStatus.READY
    assert len(result.plan.actions) == 2
    assert isinstance(
        result.plan.actions[0],
        AddImport,
    )
    assert isinstance(
        result.plan.actions[1],
        AddConstructorParameter,
    )
    assert result.plan.metadata[
        "source_task_id"
    ] == task.task_id


def test_register_module_task_builds_valid_plan(
    tmp_path,
):
    target = tmp_path / "app.module.ts"
    target.write_text(
        "export class AppModule {}\\\\n",
        encoding="utf-8",
    )

    task = RegisterModuleImportTask(
        target_file="app.module.ts",
        module_class="NewsModule",
        module_import="./news/news.module",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert result.valid
    assert len(result.plan.actions) == 2
    assert isinstance(
        result.plan.actions[0],
        AddImport,
    )
    assert isinstance(
        result.plan.actions[1],
        AddModuleImport,
    )


def test_missing_target_fails_validation(
    tmp_path,
):
    task = ConnectServiceTask(
        target_file="missing.service.ts",
        target_class="MissingService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert not result.valid
    assert not result.success
    assert result.validation.failed_count == 1


def test_execute_requires_runtime(tmp_path):
    target = tmp_path / "app.service.ts"
    target.write_text(
        "export class AppService {}\\\\n",
        encoding="utf-8",
    )

    task = ConnectServiceTask(
        target_file="app.service.ts",
        target_class="AppService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    planner = build_default_planner()

    try:
        planner.execute(
            task,
            target_project=str(tmp_path),
        )
    except PlannerError as error:
        assert "runtime is not configured" in str(
            error
        )
    else:
        raise AssertionError(
            "PlannerError was not raised"
        )
'''


def write_file(
    root: Path,
    relative: str,
    content: str,
) -> None:
    path = root / relative
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    path.write_text(
        content,
        encoding="utf-8",
    )


def run_command(
    command: list[str],
    *,
    cwd: Path,
) -> None:
    print("$", " ".join(command))
    process = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        check=False,
    )

    if process.returncode != 0:
        raise RuntimeError(
            "Command failed: "
            + " ".join(command)
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Install Atlas Patch012A Planner Facade."
        )
    )
    parser.add_argument(
        "--project-root",
        default=".",
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
    )
    args = parser.parse_args()

    root = Path(args.project_root).resolve()

    required = [
        root / "tools/ir/action.py",
        root / "tools/ir/plan.py",
        root / "tools/ir/task.py",
        root / "tools/ir/resolver.py",
        root / "tools/ir/templates.py",
        root / "tools/ir/validator.py",
    ]

    missing = [
        str(path)
        for path in required
        if not path.exists()
    ]

    if missing:
        print("Missing required files:")
        for path in missing:
            print("-", path)
        return 1

    stamp = datetime.now(
        timezone.utc
    ).strftime("%Y%m%d_%H%M%S")

    backup_root = (
        root
        / ".atlas"
        / "backups"
        / "patch_012a"
        / stamp
    )

    targets = [
        "tools/planner/__init__.py",
        "tools/planner/planner.py",
        "tools/tests/test_planner_facade.py",
    ]

    for relative in targets:
        source = root / relative
        if not source.exists():
            continue

        destination = backup_root / relative
        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        shutil.copy2(source, destination)

    print("Backup:", backup_root)

    try:
        write_file(
            root,
            "tools/planner/__init__.py",
            PLANNER_INIT,
        )
        write_file(
            root,
            "tools/planner/planner.py",
            PLANNER_PY,
        )
        write_file(
            root,
            "tools/tests/test_planner_facade.py",
            TEST_PY,
        )

        if not compileall.compile_dir(
            str(root / "tools"),
            quiet=1,
        ):
            raise RuntimeError(
                "Python compile failed"
            )

        if not args.skip_tests:
            run_command(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "tools/tests/test_planner_facade.py",
                ],
                cwd=root,
            )

        report = (
            root
            / ".atlas"
            / "reports"
            / "patch012a-planner.json"
        )
        report.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        report.write_text(
            json.dumps(
                {
                    "patch": "012A",
                    "status": "completed",
                    "backup": str(backup_root),
                    "files": targets,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        print()
        print("Patch012A Planner Facade: PASS")
        print("Report:", report)
        return 0

    except Exception as error:
        print()
        print("Patch failed:", error)
        print("Restoring backup...")

        for relative in targets:
            backup = backup_root / relative
            target = root / relative

            if backup.exists():
                target.parent.mkdir(
                    parents=True,
                    exist_ok=True,
                )
                shutil.copy2(backup, target)
            elif target.exists():
                target.unlink()

        print("Rollback complete.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
