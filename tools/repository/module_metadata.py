from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .project import AtlasProject


class ModuleMetadataError(RuntimeError):
    """Raised when NestJS module metadata cannot be analyzed."""


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class ModuleImportReference:
    module_class: str
    file_path: str
    line: int

    def to_dict(self) -> dict:
        return {
            "module_class": self.module_class,
            "file_path": self.file_path,
            "line": self.line,
        }


@dataclass(
    slots=True,
    kw_only=True,
)
class ModuleMetadataIndex:
    root: str
    imports: list[
        ModuleImportReference
    ] = field(default_factory=list)

    def imports_for_file(
        self,
        file_path: str,
    ) -> list[ModuleImportReference]:
        normalized = Path(
            file_path
        ).as_posix()

        return [
            item
            for item in self.imports
            if item.file_path == normalized
        ]

    def has_module_import(
        self,
        file_path: str,
        module_class: str,
    ) -> bool:
        normalized_class = module_class.strip()

        return any(
            item.module_class
            == normalized_class
            for item in self.imports_for_file(
                file_path
            )
        )

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "imports": [
                item.to_dict()
                for item in self.imports
            ],
        }


class ModuleMetadataAnalyzer:
    """
    Analyze NestJS @Module metadata.

    v1 extracts identifiers inside the imports array.
    """

    _module_decorator_pattern = re.compile(
        r"@Module\s*\(\s*\{",
        re.MULTILINE,
    )

    _imports_property_pattern = re.compile(
        r"\bimports\s*:\s*\[",
        re.MULTILINE,
    )

    _identifier_pattern = re.compile(
        r"\b[A-Za-z_$][\w$]*\b"
    )

    def __init__(
        self,
        project: "AtlasProject",
    ) -> None:
        self.project = project

    def build(self) -> ModuleMetadataIndex:
        references: list[
            ModuleImportReference
        ] = []

        for repository_file in (
            self.project.analysis.files
        ):
            if repository_file.suffix not in {
                ".ts",
                ".tsx",
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

            references.extend(
                self._analyze_source(
                    repository_file.path,
                    source,
                )
            )

        references.sort(
            key=lambda item: (
                item.file_path,
                item.line,
                item.module_class,
            )
        )

        return ModuleMetadataIndex(
            root=str(self.project.root),
            imports=references,
        )

    def _analyze_source(
        self,
        file_path: str,
        source: str,
    ) -> list[ModuleImportReference]:
        decorator = (
            self._module_decorator_pattern
            .search(source)
        )

        if decorator is None:
            return []

        decorator_end = self._find_balanced_end(
            source,
            decorator.end() - 1,
            opening="{",
            closing="}",
        )

        if decorator_end is None:
            raise ModuleMetadataError(
                f"Unbalanced @Module metadata in "
                f"{file_path}"
            )

        metadata = source[
            decorator.end():
            decorator_end
        ]

        imports_match = (
            self._imports_property_pattern
            .search(metadata)
        )

        if imports_match is None:
            return []

        absolute_array_start = (
            decorator.end()
            + imports_match.end()
            - 1
        )

        array_end = self._find_balanced_end(
            source,
            absolute_array_start,
            opening="[",
            closing="]",
        )

        if array_end is None:
            raise ModuleMetadataError(
                f"Unbalanced @Module imports array "
                f"in {file_path}"
            )

        array_source = source[
            absolute_array_start + 1:
            array_end
        ]

        ignored = {
            "true",
            "false",
            "null",
            "undefined",
        }

        references: list[
            ModuleImportReference
        ] = []

        for match in (
            self._identifier_pattern
            .finditer(array_source)
        ):
            name = match.group(0)

            if name in ignored:
                continue

            absolute_position = (
                absolute_array_start
                + 1
                + match.start()
            )

            line = (
                source.count(
                    "\n",
                    0,
                    absolute_position,
                )
                + 1
            )

            references.append(
                ModuleImportReference(
                    module_class=name,
                    file_path=file_path,
                    line=line,
                )
            )

        return references

    @staticmethod
    def _find_balanced_end(
        source: str,
        start: int,
        *,
        opening: str,
        closing: str,
    ) -> int | None:
        depth = 0
        quote: str | None = None
        escaped = False

        for index in range(
            start,
            len(source),
        ):
            character = source[index]

            if quote is not None:
                if escaped:
                    escaped = False
                    continue

                if character == "\\":
                    escaped = True
                    continue

                if character == quote:
                    quote = None

                continue

            if character in {
                "'",
                '"',
                "`",
            }:
                quote = character
                continue

            if character == opening:
                depth += 1
                continue

            if character == closing:
                depth -= 1

                if depth == 0:
                    return index

        return None
