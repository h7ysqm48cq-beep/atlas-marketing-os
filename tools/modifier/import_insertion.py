from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

from .ast_navigator import ImportNode
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class ImportInsertionError(RuntimeError):
    """Base error for import insertion planning."""


class DuplicateImportSymbol(ImportInsertionError):
    """Raised when the requested symbol already exists."""


class UnsupportedImportShape(ImportInsertionError):
    """Raised when an import cannot safely be modified."""


class ImportInsertionShape(str, Enum):
    """Supported import insertion shapes."""

    MULTILINE_NAMED_IMPORT = (
        "multiline_named_import"
    )
    SINGLE_LINE_NAMED_IMPORT = (
        "single_line_named_import"
    )
    DEFAULT_WITH_NAMED_IMPORT = (
        "default_with_named_import"
    )
    NEW_IMPORT_DECLARATION = (
        "new_import_declaration"
    )


@dataclass(frozen=True, slots=True)
class ImportInsertionContext:
    """
    Information required to plan one named import.

    ImportNode positions and resulting edit positions use
    TypeScript UTF-16 source offsets.
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

    def imports_from_module(
        self,
    ) -> tuple[ImportNode, ...]:
        return tuple(
            node
            for node in self.imports
            if node.module == self.module
        )

    def compatible_imports(
        self,
    ) -> tuple[ImportNode, ...]:
        return tuple(
            node
            for node in self.imports_from_module()
            if not node.side_effect_only
            and node.namespace_import is None
            and node.type_only == self.type_only
        )

    def ensure_not_duplicate(self) -> None:
        for node in self.imports:
            if node.contains_local(self.symbol):
                raise DuplicateImportSymbol(
                    f"Local import name "
                    f"{self.symbol!r} already exists"
                )

            if (
                node.module == self.module
                and node.contains_imported(
                    self.symbol
                )
            ):
                raise DuplicateImportSymbol(
                    f"{self.symbol!r} is already "
                    f"imported from {self.module!r}"
                )


@dataclass(frozen=True, slots=True)
class ImportInsertion:
    """
    Planned source edit.

    start and end use TypeScript UTF-16 positions.
    """

    start: int
    end: int
    text: str
    shape: ImportInsertionShape

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


class ImportInsertionStrategy(ABC):
    """Base class for import insertion strategies."""

    @abstractmethod
    def supports(
        self,
        context: ImportInsertionContext,
    ) -> bool:
        """Return whether this strategy supports the context."""

    @abstractmethod
    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        """Return a source edit without modifying source."""


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


def _named_binding_range(
    context: ImportInsertionContext,
    node: ImportNode,
) -> tuple[int, int]:
    start = node.named_bindings_start
    end = node.named_bindings_end

    if start is None or end is None:
        raise UnsupportedImportShape(
            "Import does not contain named bindings"
        )

    python_start = _python_index(
        context.source,
        start,
    )
    python_end = _python_index(
        context.source,
        end,
    )

    return python_start, python_end


def _is_multiline_named_import(
    context: ImportInsertionContext,
    node: ImportNode,
) -> bool:
    start, end = _named_binding_range(
        context,
        node,
    )

    return "\n" in context.source[start:end]


def _first_compatible_import(
    context: ImportInsertionContext,
) -> ImportNode | None:
    matches = context.compatible_imports()

    if not matches:
        return None

    return matches[0]


class MultilineNamedImportStrategy(
    ImportInsertionStrategy
):
    """
    Add a symbol to an existing multiline named import
    without rebuilding the declaration.
    """

    def supports(
        self,
        context: ImportInsertionContext,
    ) -> bool:
        for node in context.compatible_imports():
            if (
                node.named_bindings_start is not None
                and node.named_bindings_end is not None
                and _is_multiline_named_import(
                    context,
                    node,
                )
            ):
                return True

        return False

    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        context.ensure_not_duplicate()

        node = next(
            (
                item
                for item
                in context.compatible_imports()
                if (
                    item.named_bindings_start
                    is not None
                    and item.named_bindings_end
                    is not None
                    and _is_multiline_named_import(
                        context,
                        item,
                    )
                )
            ),
            None,
        )

        if node is None:
            raise UnsupportedImportShape(
                "No multiline named import is available"
            )

        python_start, python_end = (
            _named_binding_range(
                context,
                node,
            )
        )

        binding_text = context.source[
            python_start:python_end
        ]

        closing_relative = binding_text.rfind("}")

        if closing_relative < 0:
            raise UnsupportedImportShape(
                "Unable to locate named import "
                "closing brace"
            )

        closing_python = (
            python_start + closing_relative
        )

        closing_line_start = (
            context.source.rfind(
                "\n",
                python_start,
                closing_python,
            )
            + 1
        )

        closing_indent = context.source[
            closing_line_start:closing_python
        ]

        if closing_indent.strip():
            raise UnsupportedImportShape(
                "Named import closing brace has "
                "unexpected content before it"
            )

        item_indent: str | None = None

        for named_import in node.named_imports():
            item_start = _python_index(
                context.source,
                named_import.start,
            )

            line_start = (
                context.source.rfind(
                    "\n",
                    python_start,
                    item_start,
                )
                + 1
            )

            indent_end = line_start

            while (
                indent_end < item_start
                and context.source[indent_end]
                in {" ", "\t"}
            ):
                indent_end += 1

            item_indent = context.source[
                line_start:indent_end
            ]
            break

        if item_indent is None:
            item_indent = closing_indent + "  "

        insertion_position = _utf16_position(
            context.source,
            closing_line_start,
        )

        return ImportInsertion(
            start=insertion_position,
            end=insertion_position,
            text=(
                f"{item_indent}"
                f"{context.symbol},\n"
            ),
            shape=(
                ImportInsertionShape
                .MULTILINE_NAMED_IMPORT
            ),
        )


class SingleLineNamedImportStrategy(
    ImportInsertionStrategy
):
    """Add a symbol to an existing single-line named import."""

    def supports(
        self,
        context: ImportInsertionContext,
    ) -> bool:
        for node in context.compatible_imports():
            if (
                node.named_bindings_start is not None
                and node.named_bindings_end is not None
                and not _is_multiline_named_import(
                    context,
                    node,
                )
            ):
                return True

        return False

    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        context.ensure_not_duplicate()

        node = next(
            (
                item
                for item
                in context.compatible_imports()
                if (
                    item.named_bindings_start
                    is not None
                    and item.named_bindings_end
                    is not None
                    and not _is_multiline_named_import(
                        context,
                        item,
                    )
                )
            ),
            None,
        )

        if node is None:
            raise UnsupportedImportShape(
                "No single-line named import is available"
            )

        python_start, python_end = (
            _named_binding_range(
                context,
                node,
            )
        )

        binding_text = context.source[
            python_start:python_end
        ]

        opening_relative = binding_text.find("{")
        closing_relative = binding_text.rfind("}")

        if (
            opening_relative < 0
            or closing_relative < 0
            or closing_relative <= opening_relative
        ):
            raise UnsupportedImportShape(
                "Unable to locate named import braces"
            )

        existing_content = binding_text[
            opening_relative + 1:
            closing_relative
        ].strip()

        if existing_content:
            replacement_text = (
                "{ "
                f"{existing_content}, "
                f"{context.symbol}"
                " }"
            )
        else:
            replacement_text = (
                "{ "
                f"{context.symbol}"
                " }"
            )

        return ImportInsertion(
            start=node.named_bindings_start,
            end=node.named_bindings_end,
            text=replacement_text,
            shape=(
                ImportInsertionShape
                .SINGLE_LINE_NAMED_IMPORT
            ),
        )


class DefaultWithNamedImportStrategy(
    ImportInsertionStrategy
):
    """
    Add named bindings to an import that currently contains
    only a default import.
    """

    def supports(
        self,
        context: ImportInsertionContext,
    ) -> bool:
        for node in context.compatible_imports():
            if (
                node.default_import is not None
                and not node.named_imports()
                and node.named_bindings_start is None
            ):
                return True

        return False

    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        context.ensure_not_duplicate()

        node = next(
            (
                item
                for item
                in context.compatible_imports()
                if (
                    item.default_import is not None
                    and not item.named_imports()
                    and item.named_bindings_start
                    is None
                )
            ),
            None,
        )

        if node is None:
            raise UnsupportedImportShape(
                "No default-only import is available"
            )

        clause_end = node.import_clause_end

        if clause_end is None:
            raise UnsupportedImportShape(
                "Default import does not expose "
                "importClauseEnd"
            )

        return ImportInsertion(
            start=clause_end,
            end=clause_end,
            text=(
                f", {{ {context.symbol} }}"
            ),
            shape=(
                ImportInsertionShape
                .DEFAULT_WITH_NAMED_IMPORT
            ),
        )


def _leading_header_end(source: str) -> int:
    """
    Return a Python index after a leading shebang,
    comments and blank lines.

    This prevents new imports from being inserted above
    copyright or generated-file headers.
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
            and source[cursor] in {" ", "\t", "\r", "\n"}
        ):
            cursor += 1

        if source.startswith("//", cursor):
            newline = source.find("\n", cursor)

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
                raise UnsupportedImportShape(
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


class CreateNewImportStrategy(
    ImportInsertionStrategy
):
    """Create a new import declaration without reordering imports."""

    def supports(
        self,
        context: ImportInsertionContext,
    ) -> bool:
        return True

    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        context.ensure_not_duplicate()

        prefix = (
            "import type"
            if context.type_only
            else "import"
        )

        declaration = (
            f"{prefix} "
            f"{{ {context.symbol} }} "
            f"from "
            f"{context.quote_style}"
            f"{context.module}"
            f"{context.quote_style};"
        )

        if context.imports:
            last_import = max(
                context.imports,
                key=lambda node: node.end,
            )

            return ImportInsertion(
                start=last_import.end,
                end=last_import.end,
                text=f"\n{declaration}",
                shape=(
                    ImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )

        python_position = _leading_header_end(
            context.source
        )

        utf16_position = _utf16_position(
            context.source,
            python_position,
        )

        before = context.source[:python_position]
        after = context.source[python_position:]

        leading = ""

        if (
            before
            and not before.endswith(("\n", "\r"))
        ):
            leading = "\n"

        trailing = "\n"

        if after and not after.startswith(
            ("\n", "\r")
        ):
            trailing = "\n\n"

        return ImportInsertion(
            start=utf16_position,
            end=utf16_position,
            text=(
                f"{leading}"
                f"{declaration}"
                f"{trailing}"
            ),
            shape=(
                ImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
        )


class ImportInsertionPlanner:
    """Select the first compatible import strategy."""

    def __init__(
        self,
        strategies: list[
            ImportInsertionStrategy
        ]
        | None = None,
    ) -> None:
        self.strategies = strategies or [
            MultilineNamedImportStrategy(),
            SingleLineNamedImportStrategy(),
            DefaultWithNamedImportStrategy(),
            CreateNewImportStrategy(),
        ]

    def plan(
        self,
        context: ImportInsertionContext,
    ) -> ImportInsertion:
        for strategy in self.strategies:
            if strategy.supports(context):
                return strategy.plan(context)

        raise UnsupportedImportShape(
            "No import insertion strategy supports "
            "this context"
        )
