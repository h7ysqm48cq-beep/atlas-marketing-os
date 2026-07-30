from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ImportNode,
    NamedImportNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class ImportRemovalError(RuntimeError):
    pass


class ImportRemovalNotFound(
    ImportRemovalError
):
    pass


class ImportRemovalAmbiguous(
    ImportRemovalError
):
    pass


class ImportRemovalShape(str, Enum):
    NAMED_IMPORT = "named_import"
    LAST_NAMED_IMPORT = "last_named_import"
    DEFAULT_IMPORT = "default_import"
    NAMESPACE_IMPORT = "namespace_import"
    IMPORT_DECLARATION = "import_declaration"


@dataclass(frozen=True)
class ImportRemovalContext:
    source: str
    module: str
    symbol: str
    imports: list[ImportNode]


@dataclass(frozen=True)
class ImportRemoval:
    start: int
    end: int
    text: str
    shape: ImportRemovalShape


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


def _named_imported_name(
    node: NamedImportNode,
) -> str | None:
    for attribute in (
        "imported",
        "imported_name",
        "property_name",
        "name",
    ):
        value = getattr(
            node,
            attribute,
            None,
        )

        if isinstance(value, str):
            return value

    return None


def _named_local_name(
    node: NamedImportNode,
) -> str | None:
    for attribute in (
        "local",
        "local_name",
        "alias",
        "name",
    ):
        value = getattr(
            node,
            attribute,
            None,
        )

        if isinstance(value, str):
            return value

    return None


def _named_matches(
    node: NamedImportNode,
    symbol: str,
) -> bool:
    return symbol in {
        _named_imported_name(node),
        _named_local_name(node),
    }


def _delete_declaration(
    context: ImportRemovalContext,
    node: ImportNode,
) -> ImportRemoval:
    source = context.source

    start_python = _python_index(
        source,
        node.start,
    )
    end_python = _python_index(
        source,
        node.end,
    )

    # Consume one immediate line ending so removing an
    # entire declaration does not leave a blank line
    # containing only the deleted import.
    if source.startswith(
        "\r\n",
        end_python,
    ):
        end_python += 2
    elif (
        end_python < len(source)
        and source[end_python] == "\n"
    ):
        end_python += 1

    return ImportRemoval(
        start=_utf16_position(
            source,
            start_python,
        ),
        end=_utf16_position(
            source,
            end_python,
        ),
        text="",
        shape=(
            ImportRemovalShape
            .IMPORT_DECLARATION
        ),
    )


def _remove_default(
    context: ImportRemovalContext,
    node: ImportNode,
) -> ImportRemoval:
    if (
        node.named_bindings_start
        is None
    ):
        return _delete_declaration(
            context,
            node,
        )

    # For:
    #
    # import React, { useState } from "react";
    # import React, * as ReactNS from "react";
    #
    # everything between importClauseStart and
    # namedBindingsStart is the default import plus
    # its comma and surrounding whitespace.
    return ImportRemoval(
        start=node.import_clause_start,
        end=node.named_bindings_start,
        text="",
        shape=(
            ImportRemovalShape
            .DEFAULT_IMPORT
        ),
    )


def _remove_namespace(
    context: ImportRemovalContext,
    node: ImportNode,
) -> ImportRemoval:
    if node.default_import:
        return ImportRemoval(
            start=node.import_clause_start,
            end=node.import_clause_end,
            text=node.default_import,
            shape=(
                ImportRemovalShape
                .NAMESPACE_IMPORT
            ),
        )

    return _delete_declaration(
        context,
        node,
    )


def _remove_only_named_import(
    context: ImportRemovalContext,
    node: ImportNode,
) -> ImportRemoval:
    if node.default_import:
        return ImportRemoval(
            start=node.import_clause_start,
            end=node.import_clause_end,
            text=node.default_import,
            shape=(
                ImportRemovalShape
                .LAST_NAMED_IMPORT
            ),
        )

    return _delete_declaration(
        context,
        node,
    )


def _remove_named_import(
    context: ImportRemovalContext,
    node: ImportNode,
    target: NamedImportNode,
) -> ImportRemoval:
    named = node.named_imports()

    if len(named) == 1:
        return _remove_only_named_import(
            context,
            node,
        )

    target_index = named.index(target)

    if target_index < len(named) - 1:
        next_node = named[
            target_index + 1
        ]

        # Delete:
        #
        # A, <whitespace>
        #
        # while retaining the indentation that existed
        # before A for the following named import.
        return ImportRemoval(
            start=target.start,
            end=next_node.start,
            text="",
            shape=(
                ImportRemovalShape
                .NAMED_IMPORT
            ),
        )

    previous_node = named[
        target_index - 1
    ]

    # Deleting the final element from:
    #
    # { A, B }
    # {
    #   A,
    #   B,
    # }
    #
    # starts at the previous element's end. This removes
    # the separator before B while retaining B's trailing
    # comma in multiline imports.
    return ImportRemoval(
        start=previous_node.end,
        end=target.end,
        text="",
        shape=(
            ImportRemovalShape
            .NAMED_IMPORT
        ),
    )


class ImportRemovalPlanner:
    def plan(
        self,
        context: ImportRemovalContext,
    ) -> ImportRemoval:
        if not isinstance(
            context.source,
            str,
        ):
            raise TypeError(
                "source must be a string"
            )

        if not isinstance(
            context.module,
            str,
        ):
            raise TypeError(
                "module must be a string"
            )

        if not isinstance(
            context.symbol,
            str,
        ):
            raise TypeError(
                "symbol must be a string"
            )

        module = context.module.strip()
        symbol = context.symbol.strip()

        if not module:
            raise ValueError(
                "module cannot be empty"
            )

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        matches: list[
            tuple[
                ImportNode,
                str,
                NamedImportNode | None,
            ]
        ] = []

        for node in context.imports:
            if node.module != module:
                continue

            if node.default_import == symbol:
                matches.append(
                    (
                        node,
                        "default",
                        None,
                    )
                )

            if (
                node.namespace_import
                == symbol
            ):
                matches.append(
                    (
                        node,
                        "namespace",
                        None,
                    )
                )

            for named in node.named_imports():
                if _named_matches(
                    named,
                    symbol,
                ):
                    matches.append(
                        (
                            node,
                            "named",
                            named,
                        )
                    )

        if not matches:
            raise ImportRemovalNotFound(
                f"No import named "
                f"{symbol!r} from "
                f"{module!r} was found"
            )

        unique_matches: list[
            tuple[
                ImportNode,
                str,
                NamedImportNode | None,
            ]
        ] = []

        seen: set[
            tuple[int, str, int | None]
        ] = set()

        for node, kind, named in matches:
            identity = (
                node.start,
                kind,
                (
                    named.start
                    if named is not None
                    else None
                ),
            )

            if identity in seen:
                continue

            seen.add(identity)

            unique_matches.append(
                (
                    node,
                    kind,
                    named,
                )
            )

        if len(unique_matches) > 1:
            raise ImportRemovalAmbiguous(
                f"Multiple imports named "
                f"{symbol!r} from "
                f"{module!r} were found"
            )

        node, kind, named = (
            unique_matches[0]
        )

        if kind == "default":
            return _remove_default(
                context,
                node,
            )

        if kind == "namespace":
            return _remove_namespace(
                context,
                node,
            )

        if named is None:
            raise ImportRemovalError(
                "Named import match "
                "did not contain a node"
            )

        return _remove_named_import(
            context,
            node,
            named,
        )
