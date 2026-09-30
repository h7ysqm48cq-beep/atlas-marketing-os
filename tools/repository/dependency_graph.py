from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .project import AtlasProject


class DependencyKind(str, Enum):
    IMPORT = "import"
    CONSTRUCTOR = "constructor"


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class DependencyEdge:
    source_file: str
    target: str
    kind: DependencyKind
    symbol: str | None = None
    line: int = 0

    def to_dict(self) -> dict:
        return {
            "source_file": self.source_file,
            "target": self.target,
            "kind": self.kind.value,
            "symbol": self.symbol,
            "line": self.line,
        }


@dataclass(
    slots=True,
    kw_only=True,
)
class DependencyGraph:
    root: str
    edges: list[DependencyEdge] = field(
        default_factory=list,
    )

    @property
    def total_edges(self) -> int:
        return len(self.edges)

    def dependencies_of(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        normalized = Path(
            file_path
        ).as_posix()

        return [
            edge
            for edge in self.edges
            if edge.source_file == normalized
        ]

    def import_dependencies(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        return [
            edge
            for edge in self.dependencies_of(
                file_path
            )
            if edge.kind == DependencyKind.IMPORT
        ]

    def constructor_dependencies(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        return [
            edge
            for edge in self.dependencies_of(
                file_path
            )
            if (
                edge.kind
                == DependencyKind.CONSTRUCTOR
            )
        ]

    def find_symbol_consumers(
        self,
        symbol: str,
    ) -> list[DependencyEdge]:
        normalized = symbol.strip()

        if not normalized:
            return []

        return [
            edge
            for edge in self.edges
            if edge.symbol == normalized
        ]

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "total_edges": self.total_edges,
            "edges": [
                edge.to_dict()
                for edge in self.edges
            ],
        }


class DependencyGraphBuilder:
    """
    Build a lightweight TypeScript dependency graph.

    v1 detects:
    - ES module imports
    - constructor parameter type dependencies
    """

    _import_pattern = re.compile(
        r'''^\s*import\s+(?P<clause>.+?)\s+'''
        r'''from\s+["'](?P<module>[^"']+)["']'''
    )

    _constructor_pattern = re.compile(
        r'''\bconstructor\s*\((?P<parameters>.*?)\)''',
        re.DOTALL,
    )

    _parameter_pattern = re.compile(
        r'''
        (?:
            public|
            private|
            protected|
            readonly|
            static
        )*
        \s*
        (?P<name>[A-Za-z_$][\w$]*)
        \s*
        [?!]?
        \s*:\s*
        (?P<type>[A-Za-z_$][\w$]*)
        ''',
        re.VERBOSE,
    )

    def __init__(
        self,
        project: "AtlasProject",
    ) -> None:
        self.project = project

    def build(self) -> DependencyGraph:
        edges: list[DependencyEdge] = []

        for repository_file in (
            self.project.analysis.files
        ):
            if repository_file.suffix not in {
                ".ts",
                ".tsx",
                ".js",
                ".jsx",
            }:
                continue

            path = (
                self.project.root
                / repository_file.path
            )

            try:
                source = path.read_text(
                    encoding="utf-8",
                )
            except UnicodeDecodeError:
                continue

            edges.extend(
                self._parse_imports(
                    repository_file.path,
                    source,
                )
            )

            edges.extend(
                self._parse_constructor_dependencies(
                    repository_file.path,
                    source,
                )
            )

        edges.sort(
            key=lambda edge: (
                edge.source_file,
                edge.line,
                edge.kind.value,
                edge.target,
            )
        )

        return DependencyGraph(
            root=str(self.project.root),
            edges=edges,
        )

    def _parse_imports(
        self,
        file_path: str,
        source: str,
    ) -> list[DependencyEdge]:
        edges: list[DependencyEdge] = []

        for line_number, line in enumerate(
            source.splitlines(),
            start=1,
        ):
            match = self._import_pattern.match(
                line
            )

            if match is None:
                continue

            module = match.group("module")
            clause = match.group("clause")

            symbols = self._extract_import_symbols(
                clause
            )

            if not symbols:
                edges.append(
                    DependencyEdge(
                        source_file=file_path,
                        target=module,
                        kind=DependencyKind.IMPORT,
                        line=line_number,
                    )
                )
                continue

            for symbol in symbols:
                edges.append(
                    DependencyEdge(
                        source_file=file_path,
                        target=module,
                        kind=DependencyKind.IMPORT,
                        symbol=symbol,
                        line=line_number,
                    )
                )

        return edges

    @staticmethod
    def _extract_import_symbols(
        clause: str,
    ) -> list[str]:
        normalized = clause.strip()

        if not normalized:
            return []

        symbols: list[str] = []

        if normalized.startswith("* as "):
            namespace = normalized[5:].strip()

            if namespace:
                symbols.append(namespace)

            return symbols

        if "{" in normalized:
            before, _, remainder = (
                normalized.partition("{")
            )

            default_name = before.strip(
                " ,"
            )

            if default_name:
                symbols.append(default_name)

            named_block, _, _ = (
                remainder.partition("}")
            )

            for item in named_block.split(","):
                item = item.strip()

                if not item:
                    continue

                if " as " in item:
                    _, local = item.split(
                        " as ",
                        1,
                    )
                    symbols.append(
                        local.strip()
                    )
                else:
                    symbols.append(item)

            return symbols

        default_name = normalized.split(
            ",",
            1,
        )[0].strip()

        if default_name:
            symbols.append(default_name)

        return symbols

    def _parse_constructor_dependencies(
        self,
        file_path: str,
        source: str,
    ) -> list[DependencyEdge]:
        edges: list[DependencyEdge] = []

        for match in self._constructor_pattern.finditer(
            source
        ):
            parameters = match.group(
                "parameters"
            )

            line_number = (
                source.count(
                    "\n",
                    0,
                    match.start(),
                )
                + 1
            )

            for parameter in (
                self._parameter_pattern.finditer(
                    parameters
                )
            ):
                dependency_type = parameter.group(
                    "type"
                )

                edges.append(
                    DependencyEdge(
                        source_file=file_path,
                        target=dependency_type,
                        kind=(
                            DependencyKind.CONSTRUCTOR
                        ),
                        symbol=dependency_type,
                        line=line_number,
                    )
                )

        return edges
