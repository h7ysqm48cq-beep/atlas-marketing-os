from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .project import AtlasProject
from .symbol_index import (
    RepositorySymbol,
    SymbolKind,
)


class RepositoryResolutionError(RuntimeError):
    """Raised when repository resolution is ambiguous or fails."""


class SymbolNotFound(RepositoryResolutionError):
    """Raised when a requested symbol cannot be found."""


class SymbolAmbiguous(RepositoryResolutionError):
    """Raised when more than one symbol matches a request."""


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class ResolvedTarget:
    symbol: RepositorySymbol
    absolute_path: Path

    @property
    def file_path(self) -> str:
        return self.symbol.file_path

    def to_dict(self) -> dict:
        return {
            "name": self.symbol.name,
            "kind": self.symbol.kind.value,
            "file_path": self.symbol.file_path,
            "line": self.symbol.line,
            "exported": self.symbol.exported,
            "absolute_path": str(
                self.absolute_path
            ),
        }


class RepositoryResolver:
    """
    Resolve repository symbols into concrete source files.
    """

    def __init__(
        self,
        project: AtlasProject,
    ) -> None:
        self.project = project

    def resolve_class(
        self,
        class_name: str,
    ) -> ResolvedTarget:
        return self.resolve_symbol(
            class_name,
            kind=SymbolKind.CLASS,
        )

    def resolve_symbol(
        self,
        name: str,
        *,
        kind: SymbolKind | None = None,
    ) -> ResolvedTarget:
        if not isinstance(name, str):
            raise TypeError(
                "symbol name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "symbol name cannot be empty"
            )

        matches = self.project.symbols.find(
            normalized,
            kind=kind,
        )

        if not matches:
            kind_text = (
                f" {kind.value}"
                if kind is not None
                else ""
            )

            raise SymbolNotFound(
                f"Repository{kind_text} symbol "
                f"{normalized!r} was not found"
            )

        if len(matches) > 1:
            locations = ", ".join(
                symbol.file_path
                for symbol in matches
            )

            raise SymbolAmbiguous(
                f"Repository symbol "
                f"{normalized!r} is ambiguous: "
                f"{locations}"
            )

        symbol = matches[0]

        absolute_path = (
            self.project.root
            / symbol.file_path
        ).resolve()

        try:
            absolute_path.relative_to(
                self.project.root
            )
        except ValueError as error:
            raise RepositoryResolutionError(
                "Resolved symbol path escapes "
                "repository root"
            ) from error

        return ResolvedTarget(
            symbol=symbol,
            absolute_path=absolute_path,
        )
