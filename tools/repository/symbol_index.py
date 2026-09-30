from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Iterable

from .analyzer import (
    RepositoryAnalysis,
    RepositoryFile,
)


class SymbolKind(str, Enum):
    CLASS = "class"
    FUNCTION = "function"
    INTERFACE = "interface"
    TYPE_ALIAS = "type_alias"
    ENUM = "enum"
    VARIABLE = "variable"


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class RepositorySymbol:
    name: str
    kind: SymbolKind
    file_path: str
    line: int
    exported: bool = False

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind.value,
            "file_path": self.file_path,
            "line": self.line,
            "exported": self.exported,
        }


@dataclass(
    slots=True,
    kw_only=True,
)
class SymbolIndex:
    root: str
    symbols: list[RepositorySymbol] = field(
        default_factory=list,
    )

    @property
    def total_symbols(self) -> int:
        return len(self.symbols)

    def find(
        self,
        name: str,
        *,
        kind: SymbolKind | None = None,
    ) -> list[RepositorySymbol]:
        normalized = name.strip().lower()

        if not normalized:
            return []

        return [
            symbol
            for symbol in self.symbols
            if symbol.name.lower() == normalized
            and (
                kind is None
                or symbol.kind == kind
            )
        ]

    def search(
        self,
        query: str,
    ) -> list[RepositorySymbol]:
        normalized = query.strip().lower()

        if not normalized:
            return []

        return [
            symbol
            for symbol in self.symbols
            if normalized
            in symbol.name.lower()
        ]

    def symbols_in_file(
        self,
        file_path: str,
    ) -> list[RepositorySymbol]:
        normalized = Path(
            file_path
        ).as_posix()

        return [
            symbol
            for symbol in self.symbols
            if symbol.file_path == normalized
        ]

    def by_kind(
        self,
        kind: SymbolKind,
    ) -> list[RepositorySymbol]:
        return [
            symbol
            for symbol in self.symbols
            if symbol.kind == kind
        ]

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "total_symbols": self.total_symbols,
            "symbols": [
                symbol.to_dict()
                for symbol in self.symbols
            ],
        }


class SymbolIndexer:
    """
    Build a lightweight symbol index from source files.

    v1 uses conservative regular expressions. It is intended
    for repository discovery, not source modification.
    """

    _typescript_patterns = (
        (
            SymbolKind.CLASS,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"(?:default\s+)?"
                r"(?:abstract\s+)?"
                r"class\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
        (
            SymbolKind.INTERFACE,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"interface\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
        (
            SymbolKind.TYPE_ALIAS,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"type\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
        (
            SymbolKind.ENUM,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"(?:const\s+)?"
                r"enum\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
        (
            SymbolKind.FUNCTION,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"(?:default\s+)?"
                r"(?:async\s+)?"
                r"function\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
        (
            SymbolKind.VARIABLE,
            re.compile(
                r"^\s*"
                r"(?P<export>export\s+)?"
                r"(?:declare\s+)?"
                r"(?:const|let|var)\s+"
                r"(?P<name>[A-Za-z_$][\w$]*)\b"
            ),
        ),
    )

    _python_patterns = (
        (
            SymbolKind.CLASS,
            re.compile(
                r"^\s*class\s+"
                r"(?P<name>[A-Za-z_]\w*)\b"
            ),
        ),
        (
            SymbolKind.FUNCTION,
            re.compile(
                r"^\s*"
                r"(?:async\s+)?"
                r"def\s+"
                r"(?P<name>[A-Za-z_]\w*)\b"
            ),
        ),
    )

    def __init__(
        self,
        root: str | Path,
    ) -> None:
        self.root = Path(
            root
        ).expanduser().resolve()

    def build(
        self,
        analysis: RepositoryAnalysis,
    ) -> SymbolIndex:
        symbols: list[
            RepositorySymbol
        ] = []

        for repository_file in analysis.files:
            symbols.extend(
                self._index_file(
                    repository_file
                )
            )

        symbols.sort(
            key=lambda symbol: (
                symbol.file_path,
                symbol.line,
                symbol.name,
            )
        )

        return SymbolIndex(
            root=str(self.root),
            symbols=symbols,
        )

    def _index_file(
        self,
        repository_file: RepositoryFile,
    ) -> Iterable[RepositorySymbol]:
        path = (
            self.root
            / repository_file.path
        )

        try:
            source = path.read_text(
                encoding="utf-8",
            )
        except UnicodeDecodeError:
            return ()

        if repository_file.suffix in {
            ".ts",
            ".tsx",
            ".js",
            ".jsx",
        }:
            patterns = (
                self._typescript_patterns
            )
        elif repository_file.suffix == ".py":
            patterns = self._python_patterns
        else:
            return ()

        found: list[
            RepositorySymbol
        ] = []

        for line_number, line in enumerate(
            source.splitlines(),
            start=1,
        ):
            for kind, pattern in patterns:
                match = pattern.match(line)

                if match is None:
                    continue

                exported = bool(
                    match.groupdict().get(
                        "export"
                    )
                )

                found.append(
                    RepositorySymbol(
                        name=match.group("name"),
                        kind=kind,
                        file_path=(
                            repository_file.path
                        ),
                        line=line_number,
                        exported=exported,
                    )
                )

                break

        return tuple(found)
