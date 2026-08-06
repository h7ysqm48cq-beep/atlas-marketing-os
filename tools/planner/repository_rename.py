from __future__ import annotations

from dataclasses import dataclass

from tools.ir.action import RenameSymbol
from tools.ir.plan import ExecutionPlan
from tools.repository import (
    AtlasProject,
    RepositoryResolver,
    SymbolKind,
)


class RepositoryRenameError(RuntimeError):
    """Base repository rename planning error."""


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class RepositoryRenameTarget:
    file_path: str
    declaration: bool = False

    def to_dict(self) -> dict:
        return {
            "file_path": self.file_path,
            "declaration": self.declaration,
        }


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class RepositoryRenamePlan:
    symbol_name: str
    new_name: str
    declaration_file: str
    targets: tuple[
        RepositoryRenameTarget,
        ...,
    ]
    execution_plan: ExecutionPlan

    @property
    def total_files(self) -> int:
        return len(self.targets)

    def to_dict(self) -> dict:
        return {
            "symbol_name": self.symbol_name,
            "new_name": self.new_name,
            "declaration_file": (
                self.declaration_file
            ),
            "total_files": self.total_files,
            "targets": [
                target.to_dict()
                for target in self.targets
            ],
            "execution_plan": (
                self.execution_plan.to_dict()
            ),
        }


class RepositoryRenamePlanner:
    """
    Build a stable repository-wide rename plan.

    v1 discovers:
    - the declaration file
    - files importing the symbol
    - files containing constructor dependencies
      recorded by the Dependency Graph

    Every target file receives one RenameSymbol action.
    """

    def __init__(
        self,
        project: AtlasProject,
    ) -> None:
        self.project = project
        self.resolver = RepositoryResolver(
            project
        )

    def plan(
        self,
        symbol_name: str,
        new_name: str,
        *,
        kind: SymbolKind | None = None,
    ) -> RepositoryRenamePlan:
        symbol_name = self._normalize_name(
            symbol_name,
            field_name="symbol_name",
        )
        new_name = self._normalize_name(
            new_name,
            field_name="new_name",
        )

        resolved = self.resolver.resolve_symbol(
            symbol_name,
            kind=kind,
        )

        declaration_file = (
            resolved.file_path
        )

        consumer_files = {
            edge.source_file
            for edge
            in self.project.dependencies
            .find_symbol_consumers(
                symbol_name
            )
        }

        consumer_files.discard(
            declaration_file
        )

        ordered_files = [
            declaration_file,
            *sorted(consumer_files),
        ]

        targets = tuple(
            RepositoryRenameTarget(
                file_path=file_path,
                declaration=(
                    file_path
                    == declaration_file
                ),
            )
            for file_path in ordered_files
        )

        actions = [
            RenameSymbol(
                file_path=target.file_path,
                old_name=symbol_name,
                new_name=new_name,
            )
            for target in targets
        ]

        execution_plan = ExecutionPlan(
            title=(
                "Repository rename: "
                f"{symbol_name} -> {new_name}"
            ),
            target_project=str(
                self.project.root
            ),
            actions=actions,
            metadata={
                "operation": (
                    "repository_rename"
                ),
                "symbol_name": symbol_name,
                "new_name": new_name,
                "symbol_kind": (
                    resolved.symbol.kind.value
                ),
                "declaration_file": (
                    declaration_file
                ),
                "target_files": list(
                    ordered_files
                ),
            },
        )

        return RepositoryRenamePlan(
            symbol_name=symbol_name,
            new_name=new_name,
            declaration_file=(
                declaration_file
            ),
            targets=targets,
            execution_plan=execution_plan,
        )

    @staticmethod
    def _normalize_name(
        value: str,
        *,
        field_name: str,
    ) -> str:
        if not isinstance(value, str):
            raise TypeError(
                f"{field_name} must be a string"
            )

        normalized = value.strip()

        if not normalized:
            raise ValueError(
                f"{field_name} cannot be empty"
            )

        return normalized
