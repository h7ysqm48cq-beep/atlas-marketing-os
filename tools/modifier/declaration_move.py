from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportedDeclarationNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class DeclarationMoveError(ValueError):
    """Base declaration movement error."""


class InvalidDeclarationMove(
    DeclarationMoveError
):
    """Raised when a movement request is invalid."""


class UnsupportedDeclarationMove(
    DeclarationMoveError
):
    """Raised for declaration shapes unsupported in v1."""


class DeclarationMoveDirection(str, Enum):
    BEFORE = "before"
    AFTER = "after"
    TOP = "top"
    BOTTOM = "bottom"


@dataclass(frozen=True, slots=True)
class DeclarationMoveEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class DeclarationMovePlan:
    edits: tuple[DeclarationMoveEdit, ...]
    direction: DeclarationMoveDirection
    source_kind: str
    target_name: str | None
    comment_attached: bool


@dataclass(frozen=True, slots=True)
class DeclarationMoveContext:
    source: str
    declaration: ExportedDeclarationNode
    declarations: tuple[
        ExportedDeclarationNode,
        ...
    ]
    before: str | None = None
    after: str | None = None
    position: str | None = None


class DeclarationMovePlanner:
    def plan(
        self,
        context: DeclarationMoveContext,
    ) -> DeclarationMovePlan | None:
        if not isinstance(
            context,
            DeclarationMoveContext,
        ):
            raise TypeError(
                "context must be a "
                "DeclarationMoveContext"
            )

        self._validate_context(context)

        declarations = tuple(
            sorted(
                context.declarations,
                key=lambda item:
                    item.declaration_start,
            )
        )

        declaration = context.declaration

        try:
            source_index = declarations.index(
                declaration
            )
        except ValueError as error:
            raise InvalidDeclarationMove(
                "Source declaration is not present "
                "in the declaration collection"
            ) from error

        self._validate_source_shape(
            declaration
        )

        direction: DeclarationMoveDirection
        target_name: str | None
        target_index: int | None = None

        if context.before is not None:
            direction = (
                DeclarationMoveDirection.BEFORE
            )
            target_name = context.before

            target = self._find_target(
                declarations,
                target_name,
            )

            if target is declaration:
                return None

            target_index = declarations.index(
                target
            )

            if source_index + 1 == target_index:
                return None

        elif context.after is not None:
            direction = (
                DeclarationMoveDirection.AFTER
            )
            target_name = context.after

            target = self._find_target(
                declarations,
                target_name,
            )

            if target is declaration:
                return None

            target_index = declarations.index(
                target
            )

            if source_index - 1 == target_index:
                return None

        elif context.position == "top":
            direction = (
                DeclarationMoveDirection.TOP
            )
            target_name = None

            if source_index == 0:
                return None

        else:
            direction = (
                DeclarationMoveDirection.BOTTOM
            )
            target_name = None

            if source_index == (
                len(declarations) - 1
            ):
                return None

        block_infos = [
            self._move_block(
                context.source,
                item,
            )
            for item in declarations
        ]

        source_block = block_infos[
            source_index
        ]

        comment_attached = (
            source_block[3]
        )

        ordered_indexes = list(
            range(len(declarations))
        )

        ordered_indexes.pop(source_index)

        if direction == (
            DeclarationMoveDirection.TOP
        ):
            destination_index = 0

        elif direction == (
            DeclarationMoveDirection.BOTTOM
        ):
            destination_index = len(
                ordered_indexes
            )

        elif direction == (
            DeclarationMoveDirection.BEFORE
        ):
            assert target_index is not None

            destination_index = (
                ordered_indexes.index(
                    target_index
                )
            )

        else:
            assert target_index is not None

            destination_index = (
                ordered_indexes.index(
                    target_index
                )
                + 1
            )

        ordered_indexes.insert(
            destination_index,
            source_index,
        )

        region_start = min(
            item[0]
            for item in block_infos
        )

        region_end = max(
            item[1]
            for item in block_infos
        )

        blocks = [
            block_infos[index][2]
            .strip("\r\n")
            for index in ordered_indexes
        ]

        replacement = (
            "\n\n".join(blocks)
        )

        region_python_end = (
            utf16_offset_to_python_index(
                context.source,
                region_end,
            )
        )

        original_region = (
            context.source[
                utf16_offset_to_python_index(
                    context.source,
                    region_start,
                ):
                region_python_end
            ]
        )

        if original_region.endswith(
            ("\n", "\r")
        ):
            replacement += "\n"

        edits = (
            DeclarationMoveEdit(
                start=region_start,
                end=region_end,
                text=replacement,
            ),
        )

        return DeclarationMovePlan(
            edits=edits,
            direction=direction,
            source_kind=declaration.kind,
            target_name=target_name,
            comment_attached=comment_attached,
        )

    @staticmethod
    def _validate_context(
        context: DeclarationMoveContext,
    ) -> None:
        options = (
            context.before is not None,
            context.after is not None,
            context.position is not None,
        )

        if sum(options) != 1:
            raise InvalidDeclarationMove(
                "Exactly one of before, after or "
                "position must be provided"
            )

        if context.before is not None:
            if (
                not isinstance(
                    context.before,
                    str,
                )
                or not context.before.strip()
            ):
                raise InvalidDeclarationMove(
                    "before must be a non-empty string"
                )

        if context.after is not None:
            if (
                not isinstance(
                    context.after,
                    str,
                )
                or not context.after.strip()
            ):
                raise InvalidDeclarationMove(
                    "after must be a non-empty string"
                )

        if context.position is not None:
            if context.position not in {
                "top",
                "bottom",
            }:
                raise InvalidDeclarationMove(
                    "position must be 'top' or "
                    "'bottom'"
                )

        if not context.declarations:
            raise InvalidDeclarationMove(
                "No declarations are available"
            )

    @staticmethod
    def _validate_source_shape(
        declaration: ExportedDeclarationNode,
    ) -> None:
        if (
            declaration.kind == "variable"
            and len(
                declaration.variable_declarators
            ) != 1
        ):
            raise UnsupportedDeclarationMove(
                "Moving one declaration from a "
                "multi-variable statement is not "
                "supported in v1"
            )

        if (
            declaration.kind == "variable"
            and declaration.variable_declarators
            and (
                declaration
                .variable_declarators[0]
                .destructuring
                or len(
                    declaration
                    .variable_declarators[0]
                    .names
                ) != 1
            )
        ):
            raise UnsupportedDeclarationMove(
                "Moving a destructuring declaration "
                "is not supported in v1"
            )

    @staticmethod
    def _find_target(
        declarations: tuple[
            ExportedDeclarationNode,
            ...
        ],
        name: str,
    ) -> ExportedDeclarationNode:
        matches = [
            declaration
            for declaration in declarations
            if declaration.contains_name(name)
        ]

        if not matches:
            raise InvalidDeclarationMove(
                f"Target declaration {name!r} "
                "was not found"
            )

        if len(matches) > 1:
            raise InvalidDeclarationMove(
                f"More than one target declaration "
                f"containing {name!r} was found"
            )

        return matches[0]

    def _move_block(
        self,
        source: str,
        declaration: ExportedDeclarationNode,
    ) -> tuple[int, int, str, bool]:
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

        expanded_python_start = (
            self._leading_comment_start(
                source,
                python_start,
            )
        )

        comment_attached = (
            expanded_python_start
            < python_start
        )

        expanded_start = utf16_length(
            source[:expanded_python_start]
        )

        block = source[
            expanded_python_start:
            python_end
        ]

        return (
            expanded_start,
            end,
            block,
            comment_attached,
        )

    @staticmethod
    def _leading_comment_start(
        source: str,
        declaration_start: int,
    ) -> int:
        current_start = declaration_start

        while current_start > 0:
            previous_line_end = current_start

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
                    DeclarationMovePlanner
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
        search_end = line_end
        opening = source.rfind(
            "/*",
            0,
            search_end,
        )

        if opening < 0:
            return None

        between = source[
            opening:
            search_end
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
    def _normalize_block(
        block: str,
    ) -> str:
        if not block:
            return block

        block = block.rstrip(
            "\r\n"
        )

        return block + "\n\n"
