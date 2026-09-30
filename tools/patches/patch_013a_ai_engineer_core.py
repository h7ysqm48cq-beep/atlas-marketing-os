from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ENGINE_INIT = '''from .engine import (
    AIEngineerError,
    AIEngineerRequest,
    AIEngineerResult,
    AtlasAIEngineer,
    build_default_ai_engineer,
)

__all__ = [
    "AIEngineerError",
    "AIEngineerRequest",
    "AIEngineerResult",
    "AtlasAIEngineer",
    "build_default_ai_engineer",
]
'''

ENGINE_PY = r'''from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

from tools.ir.task import (
    ConnectServiceTask,
    RegisterModuleImportTask,
    Task,
)
from tools.planner import AtlasPlanner


class AIEngineerError(RuntimeError):
    """Raised when an AI Engineer request is invalid."""


@dataclass(slots=True, kw_only=True)
class AIEngineerRequest:
    operation: str
    arguments: dict[str, Any]
    mode: str = "plan"
    target_project: str = "."
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
    ) -> "AIEngineerRequest":
        if not isinstance(value, Mapping):
            raise TypeError("request must be a mapping")

        operation = value.get("operation")
        arguments = value.get("arguments", {})
        mode = value.get("mode", "plan")
        target_project = value.get("target_project", ".")
        metadata = value.get("metadata", {})

        if not isinstance(operation, str) or not operation.strip():
            raise AIEngineerError(
                "request.operation must be a non-empty string"
            )
        if not isinstance(arguments, Mapping):
            raise AIEngineerError(
                "request.arguments must be an object"
            )
        if not isinstance(mode, str):
            raise AIEngineerError("request.mode must be a string")
        if not isinstance(target_project, str) or not target_project.strip():
            raise AIEngineerError(
                "request.target_project must be a non-empty string"
            )
        if not isinstance(metadata, Mapping):
            raise AIEngineerError(
                "request.metadata must be an object"
            )

        normalized_mode = mode.strip().lower()
        if normalized_mode not in {"plan", "preview", "apply"}:
            raise AIEngineerError(
                "request.mode must be plan, preview, or apply"
            )

        return cls(
            operation=operation.strip().lower(),
            arguments=dict(arguments),
            mode=normalized_mode,
            target_project=target_project.strip(),
            metadata=dict(metadata),
        )


@dataclass(slots=True, kw_only=True)
class AIEngineerResult:
    request: AIEngineerRequest
    task: Task
    planner_result: Any

    @property
    def success(self) -> bool:
        runtime_result = getattr(
            self.planner_result,
            "runtime_result",
            None,
        )
        if runtime_result is not None:
            return bool(runtime_result.success)

        validation = getattr(
            self.planner_result,
            "validation",
            None,
        )
        return bool(
            validation is not None
            and not validation.has_failures
        )

    def to_dict(self) -> dict[str, Any]:
        plan = self.planner_result.plan
        validation = self.planner_result.validation
        runtime_result = getattr(
            self.planner_result,
            "runtime_result",
            None,
        )

        return {
            "success": self.success,
            "request": asdict(self.request),
            "task": self.task.to_dict(),
            "plan": plan.to_dict(),
            "validation": validation.to_dict(),
            "runtime": (
                runtime_result.to_dict()
                if runtime_result is not None
                else None
            ),
        }


class AtlasAIEngineer:
    """
    Stable facade between a future LLM and Atlas Planner/Runtime.

    v1 accepts structured instructions only. Natural-language parsing
    can be added later without changing Planner or Runtime contracts.
    """

    def __init__(self, *, planner: AtlasPlanner) -> None:
        self.planner = planner

    def handle(
        self,
        request: AIEngineerRequest | Mapping[str, Any],
    ) -> AIEngineerResult:
        if isinstance(request, Mapping):
            request = AIEngineerRequest.from_mapping(request)
        elif not isinstance(request, AIEngineerRequest):
            raise TypeError(
                "request must be AIEngineerRequest or mapping"
            )

        task = self._build_task(request)

        if request.mode == "plan":
            planner_result = self.planner.plan_and_validate(
                task,
                planner="atlas-ai-engineer",
                target_project=request.target_project,
            )
        else:
            planner_result = self.planner.execute(
                task,
                planner="atlas-ai-engineer",
                target_project=request.target_project,
                dry_run=request.mode == "preview",
                rollback_on_failure=True,
            )

        return AIEngineerResult(
            request=request,
            task=task,
            planner_result=planner_result,
        )

    def _build_task(
        self,
        request: AIEngineerRequest,
    ) -> Task:
        builders = {
            "connect_service": self._connect_service_task,
            "register_module_import": (
                self._register_module_import_task
            ),
        }

        try:
            builder = builders[request.operation]
        except KeyError as exc:
            raise AIEngineerError(
                f"Unsupported operation: {request.operation}"
            ) from exc

        return builder(
            request.arguments,
            request.metadata,
        )

    @staticmethod
    def _required_string(
        arguments: Mapping[str, Any],
        name: str,
    ) -> str:
        value = arguments.get(name)
        if not isinstance(value, str) or not value.strip():
            raise AIEngineerError(
                f"arguments.{name} must be a non-empty string"
            )
        return value.strip()

    @classmethod
    def _connect_service_task(
        cls,
        arguments: Mapping[str, Any],
        metadata: Mapping[str, Any],
    ) -> ConnectServiceTask:
        modifiers = arguments.get(
            "modifiers",
            ("private", "readonly"),
        )
        if isinstance(modifiers, list):
            modifiers = tuple(modifiers)
        if not (
            isinstance(modifiers, tuple)
            and all(
                isinstance(item, str) and item.strip()
                for item in modifiers
            )
        ):
            raise AIEngineerError(
                "arguments.modifiers must be an array of strings"
            )

        return ConnectServiceTask(
            target_file=cls._required_string(
                arguments,
                "target_file",
            ),
            target_class=cls._required_string(
                arguments,
                "target_class",
            ),
            dependency_name=cls._required_string(
                arguments,
                "dependency_name",
            ),
            dependency_type=cls._required_string(
                arguments,
                "dependency_type",
            ),
            dependency_import=cls._required_string(
                arguments,
                "dependency_import",
            ),
            modifiers=tuple(
                item.strip()
                for item in modifiers
            ),
            metadata=dict(metadata),
        )

    @classmethod
    def _register_module_import_task(
        cls,
        arguments: Mapping[str, Any],
        metadata: Mapping[str, Any],
    ) -> RegisterModuleImportTask:
        return RegisterModuleImportTask(
            target_file=cls._required_string(
                arguments,
                "target_file",
            ),
            module_class=cls._required_string(
                arguments,
                "module_class",
            ),
            module_import=cls._required_string(
                arguments,
                "module_import",
            ),
            metadata=dict(metadata),
        )


def build_default_ai_engineer(
    *,
    runtime: Any | None = None,
) -> AtlasAIEngineer:
    from tools.planner import build_default_planner

    return AtlasAIEngineer(
        planner=build_default_planner(
            runtime=runtime,
        )
    )
'''

CLI_PY = r'''from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from tools.ai_engineer import build_default_ai_engineer
from tools.runtime import build_default_runtime


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Atlas AI Engineer structured command runner"
    )
    parser.add_argument(
        "request",
        help="JSON request string or path to a JSON file",
    )
    args = parser.parse_args()

    candidate = Path(args.request)
    if candidate.exists():
        payload = json.loads(
            candidate.read_text(encoding="utf-8")
        )
    else:
        payload = json.loads(args.request)

    mode = str(payload.get("mode", "plan")).lower()
    runtime = (
        build_default_runtime(
            project_root=payload.get(
                "target_project",
                ".",
            )
        )
        if mode in {"preview", "apply"}
        else None
    )

    engineer = build_default_ai_engineer(
        runtime=runtime,
    )
    result = engineer.handle(payload)

    print(
        json.dumps(
            result.to_dict(),
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0 if result.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
'''

TEST_PY = r'''from __future__ import annotations

import pytest

from tools.ai_engineer import (
    AIEngineerError,
    AIEngineerRequest,
    build_default_ai_engineer,
)
from tools.ir.action import (
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
)


def connect_request():
    return {
        "operation": "connect_service",
        "mode": "plan",
        "target_project": ".",
        "arguments": {
            "target_file": "src/app.service.ts",
            "target_class": "AppService",
            "dependency_name": "config",
            "dependency_type": "ConfigService",
            "dependency_import": "@nestjs/config",
        },
    }


def test_connect_service_builds_expected_plan():
    result = build_default_ai_engineer().handle(
        connect_request()
    )

    assert result.success
    assert len(result.planner_result.plan.actions) == 2
    assert isinstance(
        result.planner_result.plan.actions[0],
        AddImport,
    )
    assert isinstance(
        result.planner_result.plan.actions[1],
        AddConstructorParameter,
    )


def test_register_module_builds_expected_plan():
    result = build_default_ai_engineer().handle(
        {
            "operation": "register_module_import",
            "arguments": {
                "target_file": "src/app.module.ts",
                "module_class": "ConfigModule",
                "module_import": "@nestjs/config",
            },
        }
    )

    assert result.success
    actions = result.planner_result.plan.actions
    assert isinstance(actions[0], AddImport)
    assert isinstance(actions[1], AddModuleImport)


def test_invalid_mode_is_rejected():
    payload = connect_request()
    payload["mode"] = "unsafe"

    with pytest.raises(AIEngineerError):
        AIEngineerRequest.from_mapping(payload)


def test_missing_required_argument_is_rejected():
    payload = connect_request()
    del payload["arguments"]["target_class"]

    with pytest.raises(AIEngineerError):
        build_default_ai_engineer().handle(payload)


def test_unknown_operation_is_rejected():
    with pytest.raises(AIEngineerError):
        build_default_ai_engineer().handle(
            {
                "operation": "delete_everything",
                "arguments": {},
            }
        )
'''


def write(root: Path, relative: str, content: str) -> None:
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
        root / "tools/planner/planner.py",
        root / "tools/runtime/runtime.py",
        root / "tools/ir/task.py",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        print("Missing required files:")
        for path in missing:
            print("-", path)
        return 1

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_root = root / ".atlas/backups/patch_013a" / stamp
    targets = [
        "tools/ai_engineer/__init__.py",
        "tools/ai_engineer/engine.py",
        "tools/ai_engineer/cli.py",
        "tools/tests/test_ai_engineer_core.py",
    ]

    for relative in targets:
        source = root / relative
        if source.exists():
            destination = backup_root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)

    print("Backup:", backup_root)

    try:
        write(root, targets[0], ENGINE_INIT)
        write(root, targets[1], ENGINE_PY)
        write(root, targets[2], CLI_PY)
        write(root, targets[3], TEST_PY)

        if not compileall.compile_dir(str(root / "tools"), quiet=1):
            raise RuntimeError("Python compile failed")

        if not args.skip_tests:
            command = [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "tools/tests/test_ai_engineer_core.py",
                "tools/tests/test_planner_facade.py",
                "tools/tests/test_planner_runtime_e2e.py",
                "tools/tests/test_runtime_transaction.py",
            ]
            print("$", " ".join(command))
            completed = subprocess.run(command, cwd=root)
            if completed.returncode != 0:
                raise RuntimeError("Tests failed")

        report = root / ".atlas/reports/patch013a-ai-engineer.json"
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                {
                    "patch": "013A",
                    "status": "completed",
                    "backup": str(backup_root),
                    "files": targets,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        print("Patch013A AI Engineer Core: PASS")
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
