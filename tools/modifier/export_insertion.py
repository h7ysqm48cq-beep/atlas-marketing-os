from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportNode,
    ImportNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class ExportInsertionError(RuntimeError):
    """Base error for export insertion planning."""


class DuplicateExportSymbol(ExportInsertionError):
    """Raised when the requested export already exists."""


class InvalidExportInsertion(
    ExportInsertionError
):
    """Raised when an export request is invalid."""


class ExportInsertionShape(str, Enum):
    """Supported export insertion shapes."""

    NAMED_EXPORT = "named_export"
    RE_EXPORT = "re_export"
    TYPE_EXPORT = "type_export"
    SINGLE_LINE_NAMED_EXPORT = (
        "single_line_named_export"
    )
    MULTILINE_NAMED_EXPORT = (
        "multiline_named_export"
    )
    EXPORT_ALL = "export_all"
    NAMESPACE_EXPORT = "namespace_export"


@dataclass(frozen=True, slots=True)
class ExportInsertionContext:
    """
    Information required to plan one export insertion.

    All source edit positions use TypeScript UTF-16
    source offsets.
    """

    source: str
    exports: tuple[ExportNode, ...]
    imports: tuple[ImportNode, ...] = ()

    symbol: str | None = None
    module: str | None = None
    exported_as: str | None = None

    type_only: bool = False
    export_all: bool = False
    namespace_export: str | None = None

    quote_style: str = "'"

    def __post_init__(self) -> None:
        if not isinstance(self.source, str):
            raise TypeError(
                "source must be a string"
            )

        if not isinstance(self.exports, tuple):
            raise TypeError(
                "exports must be a tuple"
            )

        if not all(
            isinstance(node, ExportNode)
            for node in self.exports
        ):
            raise TypeError(
                "exports must contain ExportNode objects"
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

        for field_name in (
            "symbol",
            "module",
            "exported_as",
            "namespace_export",
        ):
            value = getattr(
                self,
                field_name,
            )

            if value is None:
                continue

            if not isinstance(value, str):
                raise TypeError(
                    f"{field_name} must be a string "
                    "or None"
                )

            if not value.strip():
                raise ValueError(
                    f"{field_name} cannot be empty"
                )

        if not isinstance(self.type_only, bool):
            raise TypeError(
                "type_only must be a boolean"
            )

        if not isinstance(self.export_all, bool):
            raise TypeError(
                "export_all must be a boolean"
            )

        if self.quote_style not in {"'", '"'}:
            raise ValueError(
                "quote_style must be a single or "
                "double quote"
            )

        self._validate_shape()

    def _validate_shape(self) -> None:
        if (
            self.export_all
            and self.namespace_export is not None
        ):
            raise InvalidExportInsertion(
                "export_all and namespace_export "
                "cannot be combined"
            )

        if self.export_all:
            if self.module is None:
                raise InvalidExportInsertion(
                    "export_all requires a module"
                )

            if self.symbol is not None:
                raise InvalidExportInsertion(
                    "export_all cannot contain a symbol"
                )

            if self.exported_as is not None:
                raise InvalidExportInsertion(
                    "export_all cannot use exported_as"
                )

            if self.type_only:
                raise InvalidExportInsertion(
                    "export_all cannot be type-only"
                )

            return

        if self.namespace_export is not None:
            if self.module is None:
                raise InvalidExportInsertion(
                    "namespace export requires a module"
                )

            if self.symbol is not None:
                raise InvalidExportInsertion(
                    "namespace export cannot contain "
                    "a symbol"
                )

            if self.exported_as is not None:
                raise InvalidExportInsertion(
                    "namespace export cannot use "
                    "exported_as"
                )

            if self.type_only:
                raise InvalidExportInsertion(
                    "namespace export cannot be "
                    "type-only"
                )

            return

        if self.symbol is None:
            raise InvalidExportInsertion(
                "named export requires a symbol"
            )

    @property
    def normalized_symbol(self) -> str | None:
        if self.symbol is None:
            return None

        return self.symbol.strip()

    @property
    def normalized_module(self) -> str | None:
        if self.module is None:
            return None

        return self.module.strip()

    @property
    def normalized_exported_as(
        self,
    ) -> str | None:
        if self.exported_as is None:
            return None

        return self.exported_as.strip()

    @property
    def normalized_namespace(
        self,
    ) -> str | None:
        if self.namespace_export is None:
            return None

        return self.namespace_export.strip()


@dataclass(frozen=True, slots=True)
class ExportInsertion:
    """
    Planned source replacement.

    start and end use TypeScript UTF-16 offsets.
    """

    start: int
    end: int
    text: str
    shape: ExportInsertionShape

    def __post_init__(self) -> None:
        for field_name in ("start", "end"):
            value = getattr(
                self,
                field_name,
            )

            if (
                isinstance(value, bool)
                or not isinstance(value, int)
            ):
                raise TypeError(
                    f"{field_name} must be an integer"
                )

            if value < 0:
                raise ValueError(
                    f"{field_name} cannot be negative"
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


def _line_ending(source: str) -> str:
    if "\r\n" in source:
        return "\r\n"

    return "\n"


def _statement_end(
    source: str,
    position: int,
) -> int:
    """
    Extend a declaration end position across its existing
    line ending when one immediately follows.
    """

    source_length = utf16_length(source)

    if position >= source_length:
        return position

    encoded = source.encode(
        "utf-16-le"
    )

    byte_position = position * 2
    remaining = encoded[byte_position:]

    crlf = "\r\n".encode(
        "utf-16-le"
    )
    lf = "\n".encode(
        "utf-16-le"
    )

    if remaining.startswith(crlf):
        return position + 2

    if remaining.startswith(lf):
        return position + 1

    return position


def _named_export_exists(
    context: ExportInsertionContext,
) -> bool:
    symbol = context.normalized_symbol
    exported_as = (
        context.normalized_exported_as
        or symbol
    )
    module = context.normalized_module

    if symbol is None:
        return False

    for node in context.exports:
        if node.module != module:
            continue

        if node.export_all:
            continue

        if node.namespace_export is not None:
            continue

        if node.type_only != context.type_only:
            continue

        for item in node.named_exports():
            if (
                item.local == symbol
                and item.exported == exported_as
                and item.type_only
                == context.type_only
            ):
                return True

    return False


def _export_all_exists(
    context: ExportInsertionContext,
) -> bool:
    module = context.normalized_module

    return any(
        node.module == module
        and node.export_all
        and node.namespace_export is None
        for node in context.exports
    )


def _namespace_export_exists(
    context: ExportInsertionContext,
) -> bool:
    module = context.normalized_module
    namespace = context.normalized_namespace

    return any(
        node.module == module
        and node.namespace_export == namespace
        for node in context.exports
    )


def _python_index(
    source: str,
    utf16_position: int,
) -> int:
    return utf16_offset_to_python_index(
        source,
        utf16_position,
    )


def _raw_field(
    raw: object,
    name: str,
) -> object | None:
    if isinstance(raw, dict):
        return raw.get(name)

    return getattr(
        raw,
        name,
        None,
    )


def _export_clause_end(
    node: ExportNode,
) -> int | None:
    value = _raw_field(
        node.raw,
        "exportClauseEnd",
    )

    if value is None:
        return None

    if (
        isinstance(value, bool)
        or not isinstance(value, int)
    ):
        raise InvalidExportInsertion(
            "Export exportClauseEnd must be "
            "an integer or null"
        )

    return value


def _compatible_named_export(
    context: ExportInsertionContext,
) -> ExportNode | None:
    """
    Return the first named export declaration that can
    safely receive the requested symbol.

    Local exports only merge with local exports.
    Re-exports only merge with the same module.
    Declaration-level type exports only merge with the
    same declaration-level type-only shape.
    """

    if (
        context.export_all
        or context.namespace_export is not None
        or context.normalized_symbol is None
    ):
        return None

    module = context.normalized_module

    for node in context.exports:
        if node.module != module:
            continue

        if node.export_all:
            continue

        if node.namespace_export is not None:
            continue

        if node.type_only != context.type_only:
            continue

        if not node.named_exports():
            continue

        if _export_clause_end(node) is None:
            continue

        return node

    return None


def _render_binding(
    context: ExportInsertionContext,
) -> str:
    symbol = context.normalized_symbol

    if symbol is None:
        raise InvalidExportInsertion(
            "Missing named export symbol"
        )

    exported_as = (
        context.normalized_exported_as
    )

    if (
        exported_as is not None
        and exported_as != symbol
    ):
        return (
            f"{symbol} as {exported_as}"
        )

    return symbol


def _merge_named_export(
    context: ExportInsertionContext,
    node: ExportNode,
) -> ExportInsertion:
    named = node.named_exports()

    if not named:
        raise InvalidExportInsertion(
            "Cannot merge into an export declaration "
            "without named exports"
        )

    clause_end = _export_clause_end(
        node
    )

    if clause_end is None:
        raise InvalidExportInsertion(
            "Named export declaration does not expose "
            "an export clause range"
        )

    last = named[-1]

    last_python = _python_index(
        context.source,
        last.end,
    )

    clause_end_python = _python_index(
        context.source,
        clause_end,
    )

    clause_tail = context.source[
        last_python:clause_end_python
    ]

    binding = _render_binding(
        context
    )

    multiline = (
        "\n" in clause_tail
        or "\r" in clause_tail
    )

    if not multiline:
        return ExportInsertion(
            start=last.end,
            end=last.end,
            text=f", {binding}",
            shape=(
                ExportInsertionShape
                .SINGLE_LINE_NAMED_EXPORT
            ),
        )

    closing_brace_index = (
        clause_tail.rfind("}")
    )

    if closing_brace_index == -1:
        raise InvalidExportInsertion(
            "Multiline named export clause does not "
            "contain a closing brace"
        )

    before_closing_brace = clause_tail[
        :closing_brace_index
    ]

    trailing_comma = (
        before_closing_brace
        .rstrip()
        .endswith(",")
    )

    newline = _line_ending(
        context.source
    )

    last_start_python = _python_index(
        context.source,
        last.start,
    )

    line_start = context.source.rfind(
        "\n",
        0,
        last_start_python,
    )

    if line_start == -1:
        line_start = context.source.rfind(
            "\r",
            0,
            last_start_python,
        )

    line_start += 1

    indentation = context.source[
        line_start:last_start_python
    ]

    if indentation.strip():
        raise InvalidExportInsertion(
            "Could not determine multiline export "
            "element indentation"
        )

    closing_line_start = max(
        before_closing_brace.rfind("\n"),
        before_closing_brace.rfind("\r"),
    )

    if closing_line_start == -1:
        closing_indentation = ""
    else:
        closing_indentation = (
            before_closing_brace[
                closing_line_start + 1:
            ]
        )

    if closing_indentation.strip():
        raise InvalidExportInsertion(
            "Could not determine closing brace "
            "indentation"
        )

    if trailing_comma:
        replacement_tail = (
            ","
            + newline
            + indentation
            + binding
            + ","
            + newline
            + closing_indentation
            + "}"
        )
    else:
        replacement_tail = (
            ","
            + newline
            + indentation
            + binding
            + newline
            + closing_indentation
            + "}"
        )

    return ExportInsertion(
        start=last.end,
        end=clause_end,
        text=replacement_tail,
        shape=(
            ExportInsertionShape
            .MULTILINE_NAMED_EXPORT
        ),
    )


def _render_statement(
    context: ExportInsertionContext,
) -> tuple[str, ExportInsertionShape]:
    module = context.normalized_module
    quote = context.quote_style

    if context.export_all:
        return (
            f"export * from "
            f"{quote}{module}{quote};",
            ExportInsertionShape.EXPORT_ALL,
        )

    namespace = context.normalized_namespace

    if namespace is not None:
        return (
            f"export * as {namespace} from "
            f"{quote}{module}{quote};",
            ExportInsertionShape.NAMESPACE_EXPORT,
        )

    symbol = context.normalized_symbol

    if symbol is None:
        raise InvalidExportInsertion(
            "Missing named export symbol"
        )

    exported_as = (
        context.normalized_exported_as
    )

    binding = symbol

    if (
        exported_as is not None
        and exported_as != symbol
    ):
        binding = (
            f"{symbol} as {exported_as}"
        )

    export_prefix = (
        "export type"
        if context.type_only
        else "export"
    )

    module_suffix = ""

    if module is not None:
        module_suffix = (
            f" from {quote}{module}{quote}"
        )

    statement = (
        f"{export_prefix} "
        f"{{ {binding} }}"
        f"{module_suffix};"
    )

    if context.type_only:
        shape = ExportInsertionShape.TYPE_EXPORT
    elif module is not None:
        shape = ExportInsertionShape.RE_EXPORT
    else:
        shape = ExportInsertionShape.NAMED_EXPORT

    return statement, shape


def _is_local_named_export(
    context: ExportInsertionContext,
) -> bool:
    return (
        not context.export_all
        and context.namespace_export is None
        and context.normalized_module is None
    )


def _top_level_export_nodes(
    context: ExportInsertionContext,
) -> tuple[ExportNode, ...]:
    """
    Return exports that belong to the top re-export area.

    Local exports such as `export { local };` are excluded
    because they normally belong after the file body.
    """

    return tuple(
        node
        for node in context.exports
        if (
            node.module is not None
            or node.export_all
            or node.namespace_export is not None
        )
    )


def _insertion_position(
    context: ExportInsertionContext,
) -> int:
    if _is_local_named_export(context):
        return utf16_length(
            context.source
        )

    top_exports = _top_level_export_nodes(
        context
    )

    candidates: list[int] = []

    candidates.extend(
        node.end
        for node in context.imports
    )

    candidates.extend(
        node.end
        for node in top_exports
    )

    if candidates:
        return _statement_end(
            context.source,
            max(candidates),
        )

    return 0


def _ends_with_blank_line(
    source: str,
    newline: str,
) -> bool:
    return source.endswith(
        newline + newline
    )


def _ends_with_line_ending(
    source: str,
) -> bool:
    return source.endswith(
        ("\n", "\r")
    )


def _local_export_insertion_text(
    context: ExportInsertionContext,
    statement: str,
) -> str:
    newline = _line_ending(
        context.source
    )

    if not context.source:
        return statement + newline

    if _ends_with_blank_line(
        context.source,
        newline,
    ):
        return statement + newline

    if _ends_with_line_ending(
        context.source
    ):
        return (
            newline
            + statement
            + newline
        )

    return (
        newline
        + newline
        + statement
        + newline
    )


def _insertion_text(
    context: ExportInsertionContext,
    statement: str,
    position: int,
) -> str:
    if _is_local_named_export(context):
        return _local_export_insertion_text(
            context,
            statement,
        )

    newline = _line_ending(
        context.source
    )

    source_length = utf16_length(
        context.source
    )

    if position == 0:
        if not context.source:
            return statement + newline

        return statement + newline + newline

    if position >= source_length:
        if _ends_with_line_ending(
            context.source
        ):
            return statement + newline

        return newline + statement + newline

    return statement + newline


class ExportInsertionPlanner:
    """Plan insertion of one export declaration."""

    def plan(
        self,
        context: ExportInsertionContext,
    ) -> ExportInsertion:
        if not isinstance(
            context,
            ExportInsertionContext,
        ):
            raise TypeError(
                "context must be an "
                "ExportInsertionContext"
            )

        if context.export_all:
            if _export_all_exists(context):
                raise DuplicateExportSymbol(
                    f"Export-all from "
                    f"{context.normalized_module!r} "
                    "already exists"
                )

        elif (
            context.namespace_export
            is not None
        ):
            if _namespace_export_exists(
                context
            ):
                raise DuplicateExportSymbol(
                    f"Namespace export "
                    f"{context.normalized_namespace!r} "
                    f"from "
                    f"{context.normalized_module!r} "
                    "already exists"
                )

        elif _named_export_exists(context):
            exported_name = (
                context.normalized_exported_as
                or context.normalized_symbol
            )

            raise DuplicateExportSymbol(
                f"Export {exported_name!r} "
                "already exists"
            )

        compatible = _compatible_named_export(
            context
        )

        if compatible is not None:
            return _merge_named_export(
                context,
                compatible,
            )

        statement, shape = _render_statement(
            context
        )

        position = _insertion_position(
            context
        )

        return ExportInsertion(
            start=position,
            end=position,
            text=_insertion_text(
                context,
                statement,
                position,
            ),
            shape=shape,
        )
