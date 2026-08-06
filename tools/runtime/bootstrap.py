from __future__ import annotations

from pathlib import Path

from tools.ir.action import (
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
    CreateFile,
    RenameSymbol,
    WorkspaceEdit,
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
    AddModuleImportExecutor,
    CreateFileExecutor,
    RenameSymbolExecutor,
    WorkspaceEditExecutor,
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
    executor_registry.register(
        AddModuleImport,
        AddModuleImportExecutor(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        ),
    )
    executor_registry.register(
        CreateFile,
        CreateFileExecutor(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        ),
    )
    executor_registry.register(
        RenameSymbol,
        RenameSymbolExecutor(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        ),
    )
    executor_registry.register(
        WorkspaceEdit,
        WorkspaceEditExecutor(
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
