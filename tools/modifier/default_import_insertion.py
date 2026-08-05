from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import ImportNode
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class DefaultImportInsertionError(RuntimeError):
    """Base error for default import insertion."""


class DefaultImportConflict(
    DefaultImportInsertionError
):
    """Raised when a module already has another default import."""


class DuplicateDefaultImport(
    DefaultImportInsertionError
):
    """Raised when the requested default import already exists."""


class DefaultImportInsertionShape(str, Enum):
    EXISTING_IMPORT_CLAUSE = (
        "existing_import_clause"
    )
    NEW_IMPORT_DECLARATION = (
        "new_import_declaration"
    )


@dataclass(frozen=True, slots=True)
class DefaultImportInsertionContext:
    """
    Context for inserting one default import.

    All ImportNode positions and planned edit positions are
    TypeScript UTF-16 offsets.
    """

    source: str
    module: str
    symbol: str
    imports: tuple[ImportNode, ...]
    type_only: bool = False
    quote_style: str = "'"

    def __post_init__(self) -> None:
        if not isinstance(self.source, str):
            raise TypeError(
                "source must be a string"
            )

        for name in ("module", "symbol"):
            value = getattr(self, name)

            if not isinstance(value, str):
                raise TypeError(
                    f"{name} must be a string"
                )

            if not value.strip():
                raise ValueError(
                    f"{name} cannot be empty"
                )

        if not isinstance(self.imports, tuple):
            raise TypeError(
                "imports must be a tuple"
            )

        if not all(
            isinstance(node, ImportNode)
            for node in self.imports
        ):
            raise TypeError(
                "imports must contain ImportNode objects"
            )

        if not isinstance(self.type_only, bool):
            raise TypeError(
                "type_only must be a boolean"
            )

        if self.quote_style not in {"'", '"'}:
            raise ValueError(
                "quote_style must be a single or "
                "double quote"
            )


@dataclass(frozen=True, slots=True)
class DefaultImportInsertion:
    """
    Planned UTF-16 source edit.

    start == end means insertion.
    """

    start: int
    end: int
    text: str
    shape: DefaultImportInsertionShape

    def __post_init__(self) -> None:
        for name in ("start", "end"):
            value = getattr(self, name)

            if (
                isinstance(value, bool)
                or not isinstance(value, int)
            ):
                raise TypeError(
                    f"{name} must be an integer"
                )

            if value < 0:
                raise ValueError(
                    f"{name} cannot be negative"
                )

        if self.end < self.start:
            raise ValueError(
                "end cannot be before start"
            )

        if not isinstance(self.text, str):
            raise TypeError(
                "text must be a string"
            )

        if not self.text:
            raise ValueError(
                "text cannot be empty"
            )


def _matching_imports(
    context: DefaultImportInsertionContext,
) -> tuple[ImportNode, ...]:
    return tuple(
        node
        for node in context.imports
        if (
            node.module == context.module
            and not node.side_effect_only
            and node.type_only == context.type_only
        )
    )


def _validate_existing_default(
    context: DefaultImportInsertionContext,
) -> None:
    for node in context.imports:
        if node.default_import == context.symbol:
            if node.module == context.module:
                raise DuplicateDefaultImport(
                    f"Default import "
                    f"{context.symbol!r} already exists "
                    f"from {context.module!r}"
                )

            raise DefaultImportConflict(
                f"Local import name "
                f"{context.symbol!r} is already used "
                f"by module {node.module!r}"
            )

        if node.contains_local(context.symbol):
            raise DefaultImportConflict(
                f"Local import name "
                f"{context.symbol!r} already exists"
            )

    for node in _matching_imports(context):
        if (
            node.default_import is not None
            and node.default_import
            != context.symbol
        ):
            raise DefaultImportConflict(
                f"{context.module!r} already has "
                f"default import "
                f"{node.default_import!r}"
            )


def _python_index(
    source: str,
    utf16_position: int,
) -> int:
    return utf16_offset_to_python_index(
        source,
        utf16_position,
    )


def _utf16_position(
    source: str,
    python_index: int,
) -> int:
    return utf16_length(
        source[:python_index]
    )


def _leading_header_end(source: str) -> int:
    """
    Return the insertion point after a leading shebang,
    comments and blank lines.
    """

    index = 0
    length = len(source)

    if source.startswith("\ufeff"):
        index = 1

    if source.startswith("#!", index):
        newline = source.find("\n", index)

        if newline < 0:
            return length

        index = newline + 1

    while index < length:
        cursor = index

        while (
            cursor < length
            and source[cursor]
            in {" ", "\t", "\r", "\n"}
        ):
            cursor += 1

        if source.startswith("//", cursor):
            newline = source.find(
                "\n",
                cursor,
            )

            if newline < 0:
                return length

            index = newline + 1
            continue

        if source.startswith("/*", cursor):
            closing = source.find(
                "*/",
                cursor + 2,
            )

            if closing < 0:
                raise DefaultImportInsertionError(
                    "Unterminated leading block comment"
                )

            index = closing + 2

            if (
                index < length
                and source[index] == "\r"
            ):
                index += 1

            if (
                index < length
                and source[index] == "\n"
            ):
                index += 1

            continue

        return cursor

    return index


def _new_import_position(
    context: DefaultImportInsertionContext,
) -> tuple[int, int, str, str]:
    """
    Return the replacement range and spacing for
    a new default import declaration.
    """

    if context.imports:
        last_import = max(
            context.imports,
            key=lambda node: node.end,
        )

        gap_end_python = _python_index(
            context.source,
            last_import.end,
        )

        while (
            gap_end_python
            < len(context.source)
            and context.source[
                gap_end_python
            ] in " \t\r\n"
        ):
            gap_end_python += 1

        return (
            last_import.end,
            _utf16_position(
                context.source,
                gap_end_python,
            ),
            "\n\n",
            "\n\n",
        )

    python_position = _leading_header_end(
        context.source
    )

    position = _utf16_position(
        context.source,
        python_position,
    )

    before = context.source[
        :python_position
    ]
    after = context.source[
        python_position:
    ]

    leading = ""

    if (
        before
        and not before.endswith(
            ("\n", "\r")
        )
    ):
        leading = "\n"

    trailing = "\n"

    if (
        after
        and not after.startswith(
            ("\n", "\r")
        )
    ):
        trailing = "\n\n"

    return (
        position,
        position,
        leading,
        trailing,
    )


class DefaultImportInsertionPlanner:
    """Plan insertion of one default TypeScript import."""

    def plan(
        self,
        context: DefaultImportInsertionContext,
    ) -> DefaultImportInsertion:
        _validate_existing_default(context)

        matches = _matching_imports(context)

        for node in matches:
            if node.import_clause_start is None:
                continue

            if node.default_import is not None:
                continue

            return DefaultImportInsertion(
                start=node.import_clause_start,
                end=node.import_clause_start,
                text=f"{context.symbol}, ",
                shape=(
                    DefaultImportInsertionShape
                    .EXISTING_IMPORT_CLAUSE
                ),
            )

        (
            start,
            end,
            leading,
            trailing,
        ) = _new_import_position(
            context
        )

        prefix = (
            "import type"
            if context.type_only
            else "import"
        )

        declaration = (
            f"{prefix} "
            f"{context.symbol} "
            f"from "
            f"{context.quote_style}"
            f"{context.module}"
            f"{context.quote_style};"
        )

        return DefaultImportInsertion(
            start=start,
            end=end,
            text=(
                f"{leading}"
                f"{declaration}"
                f"{trailing}"
            ),
            shape=(
                DefaultImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
        )
