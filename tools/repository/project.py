from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .analyzer import (
    RepositoryAnalysis,
    RepositoryAnalyzer,
    RepositoryFile,
)
from .dependency_graph import (
    DependencyEdge,
    DependencyGraph,
    DependencyGraphBuilder,
)
from .module_metadata import (
    ModuleImportReference,
    ModuleMetadataAnalyzer,
    ModuleMetadataIndex,
)
from .symbol_index import (
    RepositorySymbol,
    SymbolIndex,
    SymbolIndexer,
    SymbolKind,
)


@dataclass(
    slots=True,
    kw_only=True,
)
class AtlasProject:
    root: Path
    analysis: RepositoryAnalysis
    symbols: SymbolIndex
    dependencies: DependencyGraph
    modules: ModuleMetadataIndex

    @classmethod
    def load(
        cls,
        root: str | Path,
    ) -> "AtlasProject":
        resolved_root = Path(
            root
        ).expanduser().resolve()

        analysis = RepositoryAnalyzer(
            resolved_root
        ).analyze()

        symbols = SymbolIndexer(
            resolved_root
        ).build(analysis)

        project = cls(
            root=resolved_root,
            analysis=analysis,
            symbols=symbols,
            dependencies=DependencyGraph(
                root=str(resolved_root),
            ),
            modules=ModuleMetadataIndex(
                root=str(resolved_root),
            ),
        )

        project.dependencies = (
            DependencyGraphBuilder(
                project
            ).build()
        )

        project.modules = (
            ModuleMetadataAnalyzer(
                project
            ).build()
        )

        return project

    @property
    def total_files(self) -> int:
        return self.analysis.total_files

    @property
    def total_symbols(self) -> int:
        return self.symbols.total_symbols

    def find_file(
        self,
        name: str,
    ) -> RepositoryFile | None:
        matches = self.analysis.find_by_name(
            name
        )

        if not matches:
            return None

        return matches[0]

    def find_files(
        self,
        query: str,
    ) -> list[RepositoryFile]:
        return self.analysis.search_paths(
            query
        )

    def find_symbol(
        self,
        name: str,
        *,
        kind: SymbolKind | None = None,
    ) -> RepositorySymbol | None:
        matches = self.symbols.find(
            name,
            kind=kind,
        )

        if not matches:
            return None

        return matches[0]

    def find_symbols(
        self,
        query: str,
    ) -> list[RepositorySymbol]:
        return self.symbols.search(
            query
        )

    def classes(
        self,
    ) -> list[RepositorySymbol]:
        return self.symbols.by_kind(
            SymbolKind.CLASS
        )

    def functions(
        self,
    ) -> list[RepositorySymbol]:
        return self.symbols.by_kind(
            SymbolKind.FUNCTION
        )

    def module_imports_of(
        self,
        file_path: str,
    ) -> list[ModuleImportReference]:
        return self.modules.imports_for_file(
            file_path
        )

    def has_module_import(
        self,
        file_path: str,
        module_class: str,
    ) -> bool:
        return self.modules.has_module_import(
            file_path,
            module_class,
        )

    def dependencies_of(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        return self.dependencies.dependencies_of(
            file_path
        )

    def constructor_dependencies_of(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        return (
            self.dependencies
            .constructor_dependencies(
                file_path
            )
        )

    def import_dependencies_of(
        self,
        file_path: str,
    ) -> list[DependencyEdge]:
        return (
            self.dependencies
            .import_dependencies(
                file_path
            )
        )

    def symbols_in_file(
        self,
        file_path: str,
    ) -> list[RepositorySymbol]:
        return self.symbols.symbols_in_file(
            file_path
        )

    def resolve_symbol_file(
        self,
        symbol_name: str,
        *,
        kind: SymbolKind | None = None,
    ) -> str | None:
        symbol = self.find_symbol(
            symbol_name,
            kind=kind,
        )

        if symbol is None:
            return None

        return symbol.file_path

    def to_dict(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "total_files": self.total_files,
            "total_symbols": self.total_symbols,
            "analysis": self.analysis.to_dict(),
            "symbols": self.symbols.to_dict(),
            "dependencies": (
                self.dependencies.to_dict()
            ),
            "modules": self.modules.to_dict(),
        }
