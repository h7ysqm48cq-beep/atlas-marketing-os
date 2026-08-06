from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    AddModuleImport,
)

from .base import BaseTypeScriptExecutor


@dataclass(
    slots=True,
    frozen=True,
)
class ModuleImportExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class AddModuleImportExecutor(
    BaseTypeScriptExecutor,
):
    """
    Add a class to a NestJS @Module imports array.

    Examples:

        @Module({
          imports: [],
        })

    becomes:

        @Module({
          imports: [ConfigModule],
        })
    """

    _module_pattern = re.compile(
        r"@Module\s*\(\s*\{",
        re.MULTILINE,
    )

    _imports_pattern = re.compile(
        r"\bimports\s*:\s*\[",
        re.MULTILINE,
    )

    def __init__(
        self,
        *,
        project_root: str | Path = ".",
        dry_run: bool = False,
        show_preview: bool = True,
    ) -> None:
        super().__init__(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        )

        self.last_result: (
            ModuleImportExecutionResult | None
        ) = None

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            AddModuleImport,
        ):
            raise TypeError(
                "AddModuleImportExecutor expected "
                "AddModuleImport, received "
                f"{type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path
        )

        if not target.exists():
            raise FileNotFoundError(
                "TypeScript file does not exist: "
                f"{target}"
            )

        if target.suffix not in {
            ".ts",
            ".tsx",
        }:
            raise RuntimeError(
                "Expected .ts or .tsx file: "
                f"{target}"
            )

        original = target.read_text(
            encoding="utf-8",
        )

        updated, changed = (
            self._add_module_import(
                original,
                action.module_class,
            )
        )

        preview = self.build_preview(
            target,
            original,
            updated,
        )

        saved = False

        if changed and not self.dry_run:
            target.write_text(
                updated,
                encoding="utf-8",
            )
            saved = True

        self.last_result = (
            ModuleImportExecutionResult(
                file_path=str(target),
                changed=changed,
                saved=saved,
                preview=preview,
            )
        )

        relative = target.relative_to(
            self.project_root
        )

        print(
            "ADD MODULE IMPORT -> "
            f"{action.module_class}"
        )
        print(f"Target -> {relative}")

        if not changed:
            print(
                "Result -> already present; "
                "no change required"
            )
            return

        self.print_preview(preview)

        if self.dry_run:
            print(
                "Result -> dry run; "
                "file was not saved"
            )
        elif saved:
            print("Result -> file saved")
        else:
            print(
                "Result -> no file write required"
            )

    @classmethod
    def _add_module_import(
        cls,
        source: str,
        module_class: str,
    ) -> tuple[str, bool]:
        module_class = module_class.strip()

        if not module_class:
            raise ValueError(
                "module_class cannot be empty"
            )

        decorator = cls._module_pattern.search(
            source
        )

        if decorator is None:
            raise RuntimeError(
                "NestJS @Module decorator "
                "was not found"
            )

        object_start = (
            decorator.end() - 1
        )

        object_end = cls._find_balanced_end(
            source,
            object_start,
            opening="{",
            closing="}",
        )

        if object_end is None:
            raise RuntimeError(
                "Unbalanced @Module metadata"
            )

        metadata = source[
            object_start + 1:
            object_end
        ]

        imports_match = (
            cls._imports_pattern.search(
                metadata
            )
        )

        if imports_match is None:
            return cls._insert_imports_property(
                source,
                object_start,
                module_class,
            )

        array_start = (
            object_start
            + 1
            + imports_match.end()
            - 1
        )

        array_end = cls._find_balanced_end(
            source,
            array_start,
            opening="[",
            closing="]",
        )

        if array_end is None:
            raise RuntimeError(
                "Unbalanced @Module imports array"
            )

        inner = source[
            array_start + 1:
            array_end
        ]

        if re.search(
            rf"\b{re.escape(module_class)}\b",
            inner,
        ):
            return source, False

        replacement = cls._append_array_item(
            source,
            array_start,
            array_end,
            inner,
            module_class,
        )

        updated = (
            source[:array_start + 1]
            + replacement
            + source[array_end:]
        )

        return updated, True

    @staticmethod
    def _insert_imports_property(
        source: str,
        object_start: int,
        module_class: str,
    ) -> tuple[str, bool]:
        line_start = source.rfind(
            "\n",
            0,
            object_start,
        ) + 1

        decorator_indent = re.match(
            r"[ \t]*",
            source[line_start:object_start],
        )

        base_indent = (
            decorator_indent.group(0)
            if decorator_indent
            else ""
        )

        property_indent = (
            base_indent + "  "
        )

        insertion = (
            "\n"
            f"{property_indent}"
            f"imports: [{module_class}],"
        )

        updated = (
            source[:object_start + 1]
            + insertion
            + source[object_start + 1:]
        )

        return updated, True

    @staticmethod
    def _append_array_item(
        source: str,
        array_start: int,
        array_end: int,
        inner: str,
        module_class: str,
    ) -> str:
        if not inner.strip():
            if "\n" not in inner:
                return module_class

            closing_line_start = source.rfind(
                "\n",
                array_start,
                array_end,
            ) + 1

            closing_indent = re.match(
                r"[ \t]*",
                source[
                    closing_line_start:
                    array_end
                ],
            )

            base_indent = (
                closing_indent.group(0)
                if closing_indent
                else ""
            )

            item_indent = (
                base_indent + "  "
            )

            return (
                "\n"
                f"{item_indent}"
                f"{module_class},"
                "\n"
                f"{base_indent}"
            )

        if "\n" not in inner:
            trimmed = inner.rstrip()
            separator = (
                " "
                if trimmed.endswith(",")
                else ", "
            )

            return (
                trimmed
                + separator
                + module_class
            )

        closing_line_start = source.rfind(
            "\n",
            array_start,
            array_end,
        ) + 1

        closing_indent_match = re.match(
            r"[ \t]*",
            source[
                closing_line_start:
                array_end
            ],
        )

        closing_indent = (
            closing_indent_match.group(0)
            if closing_indent_match
            else ""
        )

        existing_indents = re.findall(
            r"\n([ \t]+)\S",
            inner,
        )

        item_indent = (
            existing_indents[-1]
            if existing_indents
            else closing_indent + "  "
        )

        body = inner.rstrip()

        if not body.rstrip().endswith(","):
            body += ","

        return (
            body
            + "\n"
            + item_indent
            + module_class
            + ","
            + "\n"
            + closing_indent
        )

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
