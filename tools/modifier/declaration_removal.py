from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportedDeclarationNode,
    RenameSymbolNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class DeclarationRemovalError(ValueError):
    """Base declaration removal error."""


class DeclarationStillReferenced(
    DeclarationRemovalError
):
    """Raised when a declaration still has references."""


class UnsupportedDeclarationRemoval(
    DeclarationRemovalError
):
    """Raised when a declaration shape is unsupported."""


class DeclarationRemovalShape(str, Enum):
    STATEMENT = "statement"
    VARIABLE_DECLARATOR = "variable_declarator"


@dataclass(frozen=True, slots=True)
class DeclarationRemovalEdit:
    start: int
    end: int
    text: str = ""


@dataclass(frozen=True, slots=True)
class DeclarationRemovalPlan:
    edits: tuple[DeclarationRemovalEdit, ...]
    shape: DeclarationRemovalShape
    reference_count: int
    forced: bool


@dataclass(frozen=True, slots=True)
class DeclarationRemovalContext:
    source: str
    declaration: ExportedDeclarationNode
    symbol: RenameSymbolNode | None
    name: str
    force: bool = False


class DeclarationRemovalPlanner:
    def plan(
        self,
        context: DeclarationRemovalContext,
    ) -> DeclarationRemovalPlan:
        if not isinstance(
            context,
            DeclarationRemovalContext,
        ):
            raise TypeError(
                "context must be a "
                "DeclarationRemovalContext"
            )

        if not isinstance(
            context.source,
            str,
        ):
            raise TypeError(
                "source must be a string"
            )

        if not isinstance(
            context.force,
            bool,
        ):
            raise TypeError(
                "force must be a boolean"
            )

        reference_count = (
            self._reference_count(
                context.symbol,
            )
        )

        if (
            reference_count > 0
            and not context.force
        ):
            raise DeclarationStillReferenced(
                f"Declaration {context.name!r} "
                f"still has {reference_count} "
                "semantic reference(s)"
            )

        declaration = context.declaration

        if declaration.kind == "variable":
            declarator = (
                declaration.variable_declarator(
                    context.name
                )
            )

            if declarator is None:
                raise UnsupportedDeclarationRemoval(
                    f"Variable declarator "
                    f"{context.name!r} was not found"
                )

            if (
                declarator.destructuring
                or len(declarator.names) != 1
            ):
                raise UnsupportedDeclarationRemoval(
                    "Removing one name from a "
                    "destructuring declaration is "
                    "not supported in v1"
                )

            if len(
                declaration.variable_declarators
            ) == 1:
                shape = (
                    DeclarationRemovalShape
                    .STATEMENT
                )

                start, end = (
                    self._statement_removal_range(
                        context.source,
                        declaration,
                    )
                )
            else:
                shape = (
                    DeclarationRemovalShape
                    .VARIABLE_DECLARATOR
                )

                start = (
                    declarator.removal_start
                )

                end = (
                    declarator.removal_end
                )
        else:
            shape = (
                DeclarationRemovalShape.STATEMENT
            )

            start, end = (
                self._statement_removal_range(
                    context.source,
                    declaration,
                )
            )

        edit = DeclarationRemovalEdit(
            start=start,
            end=end,
        )

        return DeclarationRemovalPlan(
            edits=(edit,),
            shape=shape,
            reference_count=reference_count,
            forced=context.force,
        )

    @classmethod
    def _statement_removal_range(
        cls,
        source: str,
        declaration: ExportedDeclarationNode,
    ) -> tuple[int, int]:
        start = declaration.removal_start
        end = declaration.removal_end

        python_start = (
            utf16_offset_to_python_index(
                source,
                start,
            )
        )

        python_end = (
            utf16_offset_to_python_index(
                source,
                end,
            )
        )

        # Include immediately attached line or block
        # comments, while stopping at a blank line.
        python_start = (
            cls._leading_comment_start(
                source,
                python_start,
            )
        )

        # Removing the final declaration commonly
        # leaves the separator blank line belonging
        # to that declaration. Delete one preceding
        # newline so the file ends with exactly one
        # newline.
        if python_end == len(source):
            prefix = source[:python_start]

            if prefix.endswith(
                "\r\n\r\n"
            ):
                python_start -= 2
            elif prefix.endswith(
                "\n\n"
            ):
                python_start -= 1
            elif prefix.endswith(
                "\r\r"
            ):
                python_start -= 1

        return (
            utf16_length(
                source[:python_start]
            ),
            end,
        )

    @staticmethod
    def _leading_comment_start(
        source: str,
        declaration_start: int,
    ) -> int:
        current_start = declaration_start

        while current_start > 0:
            previous_line_end = (
                current_start
            )

            if (
                previous_line_end > 0
                and source[
                    previous_line_end - 1
                ] == "\n"
            ):
                previous_line_end -= 1

            if (
                previous_line_end > 0
                and source[
                    previous_line_end - 1
                ] == "\r"
            ):
                previous_line_end -= 1

            previous_line_start = (
                source.rfind(
                    "\n",
                    0,
                    previous_line_end,
                )
                + 1
            )

            previous_line = source[
                previous_line_start:
                previous_line_end
            ]

            stripped = (
                previous_line.strip()
            )

            if not stripped:
                break

            if stripped.startswith("//"):
                current_start = (
                    previous_line_start
                )
                continue

            if stripped.endswith("*/"):
                block_start = (
                    DeclarationRemovalPlanner
                    ._block_comment_start(
                        source,
                        previous_line_start,
                        previous_line_end,
                    )
                )

                if block_start is None:
                    break

                current_start = block_start
                continue

            break

        return current_start

    @staticmethod
    def _block_comment_start(
        source: str,
        line_start: int,
        line_end: int,
    ) -> int | None:
        opening = source.rfind(
            "/*",
            0,
            line_end,
        )

        if opening < 0:
            return None

        between = source[
            opening:
            line_end
        ]

        if "*/" not in between:
            return None

        opening_line_start = (
            source.rfind(
                "\n",
                0,
                opening,
            )
            + 1
        )

        prefix = source[
            opening_line_start:
            opening
        ]

        if prefix.strip():
            return None

        return opening_line_start

    @staticmethod
    def _reference_count(
        symbol: RenameSymbolNode | None,
    ) -> int:
        if symbol is None:
            return 0

        declaration_start = (
            symbol.identifier_start
        )

        declaration_end = (
            symbol.identifier_end
        )

        return sum(
            1
            for occurrence in symbol.occurrences
            if not (
                occurrence.start
                == declaration_start
                and occurrence.end
                == declaration_end
            )
        )
