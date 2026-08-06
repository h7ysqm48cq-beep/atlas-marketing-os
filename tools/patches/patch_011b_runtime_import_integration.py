from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


BOOTSTRAP_SOURCE = '''from __future__ import annotations

from pathlib import Path

from tools.ir.action import AddImport
from tools.ir.basic_validators import register_basic_validators
from tools.ir.registry import ExecutorRegistry
from tools.ir.validator import (
    ExecutionPlanValidator,
    ValidatorRegistry,
)

from .executors import AddImportExecutor
from .runtime import AtlasRuntime


def build_default_runtime(
    *,
    project_root: str | Path = ".",
    dry_run: bool = False,
    show_preview: bool = True,
) -> AtlasRuntime:
    """Build the default Atlas Runtime with supported executors.

    ``dry_run`` configures the executor's initial state. A value supplied
    to ``AtlasRuntime.run(..., dry_run=...)`` still takes precedence for
    that execution and is restored afterwards.
    """

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

    return AtlasRuntime(
        validator=ExecutionPlanValidator(
            validator_registry,
        ),
        executors=executor_registry,
    )
'''


INIT_SOURCE = '''from .bootstrap import build_default_runtime
from .executor import ActionExecutor
from .executors import (
    AddImportExecutor,
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
    "AddImportExecutor",
    "AtlasRuntime",
    "ImportExecutionResult",
    "MockExecutor",
    "RuntimeResult",
    "build_default_runtime",
]
'''


TEST_SOURCE = '''from __future__ import annotations

from tools.ir.action import AddImport
from tools.ir.plan import ExecutionPlan, PlanStatus
from tools.runtime import build_default_runtime


def make_plan(
    *,
    target_project: str,
    symbol: str,
) -> ExecutionPlan:
    return ExecutionPlan(
        title=f"Add {symbol}",
        target_project=target_project,
        actions=[
            AddImport(
                file_path="src/app.ts",
                symbol=symbol,
                module="@nestjs/common",
            )
        ],
    )


def test_real_import_executor_saves_file(
    tmp_path,
):
    source_dir = tmp_path / "src"
    source_dir.mkdir()

    target = source_dir / "app.ts"
    target.write_text(
        "export class App {}\\n",
        encoding="utf-8",
    )

    runtime = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    )
    plan = make_plan(
        target_project=str(tmp_path),
        symbol="Injectable",
    )

    result = runtime.run(plan)

    assert result.success
    assert plan.status == PlanStatus.COMPLETED
    assert result.executed == 1
    assert result.failed == 0
    assert len(result.records) == 1
    assert result.records[0].changed
    assert result.records[0].saved

    output = target.read_text(
        encoding="utf-8",
    )
    assert (
        "import { Injectable } "
        "from '@nestjs/common';"
    ) in output


def test_real_import_executor_is_idempotent(
    tmp_path,
):
    source_dir = tmp_path / "src"
    source_dir.mkdir()

    target = source_dir / "app.ts"
    target.write_text(
        "import { Injectable } "
        "from '@nestjs/common';\\n\\n"
        "export class App {}\\n",
        encoding="utf-8",
    )

    runtime = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    )
    plan = make_plan(
        target_project=str(tmp_path),
        symbol="Injectable",
    )

    before = target.read_text(
        encoding="utf-8",
    )
    result = runtime.run(plan)

    assert result.success
    assert result.executed == 1
    assert not result.records[0].changed
    assert not result.records[0].saved
    assert target.read_text(
        encoding="utf-8",
    ) == before


def test_real_import_executor_dry_run(
    tmp_path,
):
    source_dir = tmp_path / "src"
    source_dir.mkdir()

    target = source_dir / "app.ts"
    target.write_text(
        "export class App {}\\n",
        encoding="utf-8",
    )

    runtime = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    )
    plan = make_plan(
        target_project=str(tmp_path),
        symbol="Logger",
    )

    before = target.read_text(
        encoding="utf-8",
    )
    result = runtime.run(
        plan,
        dry_run=True,
    )

    assert result.success
    assert result.dry_run
    assert result.records[0].changed
    assert not result.records[0].saved
    assert result.records[0].preview
    assert target.read_text(
        encoding="utf-8",
    ) == before
'''


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


def write_text(root: Path, relative: str, content: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply Atlas Patch011B Runtime Import integration."
    )
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--skip-tests", action="store_true")
    args = parser.parse_args()

    root = Path(args.project_root).resolve()

    required = [
        "tools/runtime/runtime.py",
        "tools/runtime/result.py",
        "tools/runtime/executors/typescript_import.py",
        "tools/ir/action.py",
        "tools/ir/basic_validators.py",
        "tools/modifier/typescript.py",
    ]
    missing = [name for name in required if not (root / name).exists()]
    if missing:
        print("Missing required files:")
        for name in missing:
            print("-", name)
        return 1

    runtime_source = (root / "tools/runtime/runtime.py").read_text(
        encoding="utf-8"
    )
    result_source = (root / "tools/runtime/result.py").read_text(
        encoding="utf-8"
    )

    if "rollback_on_failure" not in runtime_source:
        print("Patch011A runtime changes were not detected.")
        return 1
    if "ActionRuntimeRecord" not in result_source:
        print("Patch011A result changes were not detected.")
        return 1

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_root = root / ".atlas/backups/patch_011b" / timestamp

    targets = [
        "tools/runtime/bootstrap.py",
        "tools/runtime/__init__.py",
        "tools/tests/test_runtime_import_e2e.py",
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
        write_text(root, "tools/runtime/bootstrap.py", BOOTSTRAP_SOURCE)
        write_text(root, "tools/runtime/__init__.py", INIT_SOURCE)
        write_text(
            root,
            "tools/tests/test_runtime_import_e2e.py",
            TEST_SOURCE,
        )

        if not compileall.compile_dir(str(root / "tools"), quiet=1):
            raise RuntimeError("Python compilation failed")

        if not args.skip_tests:
            run_command(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "tools/tests/test_runtime_transaction.py",
                    "tools/tests/test_runtime_import_e2e.py",
                    "tools/tests/test_import_add.py",
                    "tools/tests/test_import_insertion_branches.py",
                    "tools/tests/test_default_import_insertion_branches.py",
                    "tools/tests/test_import_removal_branches.py",
                ],
                cwd=root,
            )

        report = root / ".atlas/reports/patch011b-runtime-import.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                {
                    "patch": "011B",
                    "status": "completed",
                    "backup": str(backup_root),
                    "files": targets,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        print("Patch011B Runtime Import Integration: PASS")
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
