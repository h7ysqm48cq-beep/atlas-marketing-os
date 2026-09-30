from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


CONSTRUCTOR_EXECUTOR_SOURCE = r'''from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    AddConstructorParameter,
)
from tools.modifier.bridge import (
    TypeScriptBridge,
)
from tools.modifier.constructor_parameter import (
    ConstructorParameter,
)
from tools.modifier.typescript_constructor import (
    ConstructorModifier,
)

from .base import BaseTypeScriptExecutor


@dataclass(slots=True, frozen=True)
class ConstructorParameterExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class AddConstructorParameterExecutor(
    BaseTypeScriptExecutor,
):
    """Execute AddConstructorParameter through ConstructorModifier."""

    def __init__(
        self,
        *,
        project_root: str | Path = ".",
        dry_run: bool = False,
        show_preview: bool = True,
    ) -> None:
        super().__init__(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        )
        self.last_result: (
            ConstructorParameterExecutionResult | None
        ) = None

    @staticmethod
    def _build_parameter(
        action: AddConstructorParameter,
    ) -> ConstructorParameter:
        """Build ConstructorParameter across compatible field names."""

        signature = inspect.signature(
            ConstructorParameter
        )
        names = set(signature.parameters)
        values = {
            "name": action.parameter_name,
            "type": action.parameter_type,
            "type_annotation": action.parameter_type,
            "parameter_type": action.parameter_type,
            "modifiers": action.modifiers,
        }

        kwargs = {
            name: values[name]
            for name in names
            if name in values
        }

        if "name" not in kwargs:
            raise RuntimeError(
                "ConstructorParameter does not expose a name field"
            )

        if not any(
            key in kwargs
            for key in (
                "type",
                "type_annotation",
                "parameter_type",
            )
        ):
            raise RuntimeError(
                "ConstructorParameter does not expose a type field"
            )

        return ConstructorParameter(**kwargs)

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            AddConstructorParameter,
        ):
            raise TypeError(
                "AddConstructorParameterExecutor expected "
                "AddConstructorParameter, received "
                f"{type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path
        )

        if not target.exists():
            raise FileNotFoundError(
                f"TypeScript file does not exist: {target}"
            )

        if target.suffix not in {".ts", ".tsx"}:
            raise RuntimeError(
                f"Expected .ts or .tsx file: {target}"
            )

        original_text = target.read_text(
            encoding="utf-8",
        )

        parser_path = (
            Path(__file__).resolve().parents[2]
            / "modifier"
            / "parser.js"
        )

        bridge = TypeScriptBridge(
            project_root=self.project_root,
            parser_path=parser_path,
        )

        modifier = ConstructorModifier(
            target,
            class_name=action.class_name,
            project_root=self.project_root,
            bridge=bridge,
        )

        changed = modifier.add_parameter(
            self._build_parameter(action)
        )

        updated_text = modifier.source()
        preview = self.build_preview(
            target,
            original_text,
            updated_text,
        )

        saved = False

        if changed and not self.dry_run:
            saved = modifier.save()

        self.last_result = (
            ConstructorParameterExecutionResult(
                file_path=str(target),
                changed=changed,
                saved=saved,
                preview=preview,
            )
        )

        relative = target.relative_to(
            self.project_root
        )

        print(
            "ADD CONSTRUCTOR PARAMETER -> "
            f"{action.parameter_name}: "
            f"{action.parameter_type}"
        )
        print(f"Target -> {relative}")

        if not changed:
            print(
                "Result -> already present; "
                "no change required"
            )
            return

        self.print_preview(preview)

        if self.dry_run:
            print(
                "Result -> dry run; "
                "file was not saved"
            )
        elif saved:
            print("Result -> file saved")
        else:
            print(
                "Result -> no file write required"
            )
'''


EXECUTORS_INIT_SOURCE = r'''from .typescript_constructor import (
    AddConstructorParameterExecutor,
    ConstructorParameterExecutionResult,
)
from .typescript_import import (
    AddImportExecutor,
    ImportExecutionResult,
)

__all__ = [
    "AddConstructorParameterExecutor",
    "AddImportExecutor",
    "ConstructorParameterExecutionResult",
    "ImportExecutionResult",
]
'''


BOOTSTRAP_SOURCE = r'''from __future__ import annotations

from pathlib import Path

from tools.ir.action import (
    AddConstructorParameter,
    AddImport,
)
from tools.ir.basic_validators import (
    register_basic_validators,
)
from tools.ir.registry import ExecutorRegistry
from tools.ir.validator import (
    ExecutionPlanValidator,
    ValidatorRegistry,
)

from .executors import (
    AddConstructorParameterExecutor,
    AddImportExecutor,
)
from .runtime import AtlasRuntime


def build_default_runtime(
    *,
    project_root: str | Path = ".",
    dry_run: bool = False,
    show_preview: bool = True,
) -> AtlasRuntime:
    """Build Atlas Runtime with import and constructor executors."""

    validator_registry = ValidatorRegistry()
    register_basic_validators(
        validator_registry,
    )

    executor_registry = ExecutorRegistry()
    executor_registry.register(
        AddImport,
        AddImportExecutor(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        ),
    )
    executor_registry.register(
        AddConstructorParameter,
        AddConstructorParameterExecutor(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        ),
    )

    return AtlasRuntime(
        validator=ExecutionPlanValidator(
            validator_registry,
        ),
        executors=executor_registry,
    )
'''


RUNTIME_INIT_SOURCE = r'''from .bootstrap import build_default_runtime
from .executor import ActionExecutor
from .executors import (
    AddConstructorParameterExecutor,
    AddImportExecutor,
    ConstructorParameterExecutionResult,
    ImportExecutionResult,
)
from .mock_executor import MockExecutor
from .result import (
    ActionRuntimeRecord,
    RuntimeResult,
)
from .runtime import AtlasRuntime

__all__ = [
    "ActionExecutor",
    "ActionRuntimeRecord",
    "AddConstructorParameterExecutor",
    "AddImportExecutor",
    "AtlasRuntime",
    "ConstructorParameterExecutionResult",
    "ImportExecutionResult",
    "MockExecutor",
    "RuntimeResult",
    "build_default_runtime",
]
'''


TEST_SOURCE = r'''from __future__ import annotations

from tools.ir.plan import PlanStatus
from tools.ir.task import ConnectServiceTask
from tools.planner import build_default_planner
from tools.runtime import build_default_runtime


def write_service(
    tmp_path,
    *,
    class_name: str = "AppService",
):
    source_dir = tmp_path / "src"
    source_dir.mkdir(exist_ok=True)
    target = source_dir / "app.service.ts"
    target.write_text(
        "export class "
        f"{class_name} {{\n"
        "  constructor() {}\n"
        "}\n",
        encoding="utf-8",
    )
    return target


def make_task(
    *,
    target_class: str = "AppService",
):
    return ConnectServiceTask(
        target_file="src/app.service.ts",
        target_class=target_class,
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )


def build_planner(tmp_path):
    runtime = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    )
    return build_default_planner(
        runtime=runtime,
    )


def test_connect_service_executes_import_and_injection(
    tmp_path,
):
    target = write_service(tmp_path)
    planner = build_planner(tmp_path)

    result = planner.execute(
        make_task(),
        target_project=str(tmp_path),
    )

    assert result.success
    assert result.executed
    assert result.plan.status == PlanStatus.COMPLETED
    assert result.runtime_result.executed == 2
    assert result.runtime_result.failed == 0

    output = target.read_text(encoding="utf-8")
    assert (
        "import { ConfigService } "
        "from '@nestjs/config';"
    ) in output
    assert "private readonly config: ConfigService" in output


def test_connect_service_dry_run_changes_nothing(
    tmp_path,
):
    target = write_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    planner = build_planner(tmp_path)

    result = planner.execute(
        make_task(),
        target_project=str(tmp_path),
        dry_run=True,
    )

    assert result.success
    assert result.runtime_result.dry_run
    assert target.read_text(encoding="utf-8") == before
    assert all(
        not record.saved
        for record in result.runtime_result.records
    )


def test_connect_service_is_idempotent(
    tmp_path,
):
    target = write_service(tmp_path)
    planner = build_planner(tmp_path)

    first = planner.execute(
        make_task(),
        target_project=str(tmp_path),
    )
    assert first.success

    after_first = target.read_text(encoding="utf-8")

    second = planner.execute(
        make_task(),
        target_project=str(tmp_path),
    )

    assert second.success
    assert target.read_text(encoding="utf-8") == after_first
    assert all(
        not record.changed
        for record in second.runtime_result.records
    )


def test_constructor_failure_rolls_back_import(
    tmp_path,
):
    target = write_service(tmp_path)
    before = target.read_text(encoding="utf-8")
    planner = build_planner(tmp_path)

    result = planner.execute(
        make_task(target_class="MissingService"),
        target_project=str(tmp_path),
    )

    assert not result.success
    assert result.runtime_result.rolled_back
    assert result.plan.status == PlanStatus.ROLLED_BACK
    assert target.read_text(encoding="utf-8") == before
'''


def write_text(
    root: Path,
    relative: str,
    content: str,
) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def run_command(command: list[str], *, cwd: Path) -> None:
    print("$", " ".join(command))
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "Command failed: " + " ".join(command)
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply Atlas Patch012B Planner Runtime E2E."
    )
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()

    required = [
        root / "tools/planner/planner.py",
        root / "tools/runtime/bootstrap.py",
        root / "tools/runtime/runtime.py",
        root / "tools/modifier/constructor_parameter.py",
        root / "tools/modifier/typescript_constructor.py",
    ]

    missing = [str(path) for path in required if not path.exists()]
    if missing:
        print("Missing required files:")
        for path in missing:
            print("-", path)
        return 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_root = (
        root / ".atlas" / "backups" / "patch_012b" / stamp
    )

    targets = [
        "tools/runtime/executors/typescript_constructor.py",
        "tools/runtime/executors/__init__.py",
        "tools/runtime/bootstrap.py",
        "tools/runtime/__init__.py",
        "tools/tests/test_planner_runtime_e2e.py",
    ]

    for relative in targets:
        source = root / relative
        if not source.exists():
            continue
        destination = backup_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    print("Backup:", backup_root)

    try:
        write_text(
            root,
            "tools/runtime/executors/typescript_constructor.py",
            CONSTRUCTOR_EXECUTOR_SOURCE,
        )
        write_text(
            root,
            "tools/runtime/executors/__init__.py",
            EXECUTORS_INIT_SOURCE,
        )
        write_text(
            root,
            "tools/runtime/bootstrap.py",
            BOOTSTRAP_SOURCE,
        )
        write_text(
            root,
            "tools/runtime/__init__.py",
            RUNTIME_INIT_SOURCE,
        )
        write_text(
            root,
            "tools/tests/test_planner_runtime_e2e.py",
            TEST_SOURCE,
        )

        if not compileall.compile_dir(str(root / "tools"), quiet=1):
            raise RuntimeError("Python compile failed")

        if not args.skip_tests:
            run_command(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "tools/tests/test_planner_runtime_e2e.py",
                    "tools/tests/test_planner_facade.py",
                    "tools/tests/test_runtime_transaction.py",
                    "tools/tests/test_constructor_modifier_insert.py",
                    "tools/tests/test_import_add.py",
                ],
                cwd=root,
            )

        report = root / ".atlas" / "reports" / "patch012b-e2e.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                {
                    "patch": "012B",
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
        print("Patch012B Planner Runtime E2E: PASS")
        print("Report:", report)
        return 0

    except Exception as exc:
        print()
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
