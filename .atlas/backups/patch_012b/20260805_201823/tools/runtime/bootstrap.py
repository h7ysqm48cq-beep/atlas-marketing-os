from __future__ import annotations

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
