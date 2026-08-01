from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportNode,
    NamedExportNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class ExportRemovalError(RuntimeError):
    pass


class ExportRemovalNotFound(
    ExportRemovalError
):
    pass


class ExportRemovalAmbiguous(
    ExportRemovalError
):
    pass


class ExportRemovalShape(str, Enum):
    NAMED_EXPORT = "named_export"
    EXPORT_DECLARATION = "export_declaration"
    STAR_EXPORT = "star_export"
    NAMESPACE_EXPORT = "namespace_export"


@dataclass(frozen=True)
class ExportRemovalContext:
    source: str
    symbol: str
    exports: tuple[ExportNode, ...]
    module: str | None = None


@dataclass(frozen=True)
class ExportRemoval:
    start: int
    end: int
    text: str
    shape: ExportRemovalShape


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


def _named_matches(
    node: NamedExportNode,
    symbol: str,
) -> bool:
    return symbol in {
        node.local,
        node.exported,
    }


def _delete_declaration(
    context: ExportRemovalContext,
    node: ExportNode,
    *,
    shape: ExportRemovalShape = (
        ExportRemovalShape.EXPORT_DECLARATION
    ),
) -> ExportRemoval:
    source = context.source

    start_python = _python_index(
        source,
        node.start,
    )

    end_python = _python_index(
        source,
        node.end,
    )

    # Consume one immediate line ending so deleting an
    # entire export declaration does not leave an empty
    # line where the declaration previously existed.
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

    return ExportRemoval(
        start=_utf16_position(
            source,
            start_python,
        ),
        end=_utf16_position(
            source,
            end_python,
        ),
        text="",
        shape=shape,
    )


def _remove_named_export(
    context: ExportRemovalContext,
    node: ExportNode,
    target: NamedExportNode,
) -> ExportRemoval:
    named = node.named_exports()

    if len(named) == 1:
        return _delete_declaration(
            context,
            node,
        )

    target_index = named.index(
        target
    )

    if target_index < len(named) - 1:
        next_node = named[
            target_index + 1
        ]

        # Remove the current element, its separator and
        # following whitespace, while keeping the next
        # element's indentation.
        return ExportRemoval(
            start=target.start,
            end=next_node.start,
            text="",
            shape=(
                ExportRemovalShape
                .NAMED_EXPORT
            ),
        )

    previous_node = named[
        target_index - 1
    ]

    # Remove the separator before the final export and
    # the final export itself. Any trailing comma after
    # the target remains intact, matching the established
    # import-removal formatting strategy.
    return ExportRemoval(
        start=previous_node.end,
        end=target.end,
        text="",
        shape=(
            ExportRemovalShape
            .NAMED_EXPORT
        ),
    )


class ExportRemovalPlanner:
    def plan(
        self,
        context: ExportRemovalContext,
    ) -> ExportRemoval:
        if not isinstance(
            context.source,
            str,
        ):
            raise TypeError(
                "source must be a string"
            )

        if not isinstance(
            context.symbol,
            str,
        ):
            raise TypeError(
                "symbol must be a string"
            )

        if (
            context.module is not None
            and not isinstance(
                context.module,
                str,
            )
        ):
            raise TypeError(
                "module must be a string or None"
            )

        if not isinstance(
            context.exports,
            tuple,
        ):
            raise TypeError(
                "exports must be a tuple"
            )

        if not all(
            isinstance(node, ExportNode)
            for node in context.exports
        ):
            raise TypeError(
                "exports must contain ExportNode objects"
            )

        symbol = context.symbol.strip()

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        module: str | None = None

        if context.module is not None:
            module = context.module.strip()

            if not module:
                raise ValueError(
                    "module cannot be empty"
                )

        matches: list[
            tuple[
                ExportNode,
                str,
                NamedExportNode | None,
            ]
        ] = []

        for node in context.exports:
            if (
                module is not None
                and node.module != module
            ):
                continue

            if symbol == "*":
                if node.export_all:
                    matches.append(
                        (
                            node,
                            "star",
                            None,
                        )
                    )

                continue

            if (
                node.namespace_export
                == symbol
            ):
                matches.append(
                    (
                        node,
                        "namespace",
                        None,
                    )
                )

            for named in node.named_exports():
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
            module_text = (
                f" from {module!r}"
                if module is not None
                else ""
            )

            raise ExportRemovalNotFound(
                f"No export named "
                f"{symbol!r}"
                f"{module_text} was found"
            )

        unique_matches: list[
            tuple[
                ExportNode,
                str,
                NamedExportNode | None,
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

            seen.add(
                identity
            )

            unique_matches.append(
                (
                    node,
                    kind,
                    named,
                )
            )

        if len(unique_matches) > 1:
            module_text = (
                f" from {module!r}"
                if module is not None
                else ""
            )

            raise ExportRemovalAmbiguous(
                f"Multiple exports named "
                f"{symbol!r}"
                f"{module_text} were found"
            )

        node, kind, named = (
            unique_matches[0]
        )

        if kind == "star":
            return _delete_declaration(
                context,
                node,
                shape=(
                    ExportRemovalShape
                    .STAR_EXPORT
                ),
            )

        if kind == "namespace":
            return _delete_declaration(
                context,
                node,
                shape=(
                    ExportRemovalShape
                    .NAMESPACE_EXPORT
                ),
            )

        if named is None:
            raise ExportRemovalError(
                "Named export match did not "
                "contain a node"
            )

        return _remove_named_export(
            context,
            node,
            named,
        )
