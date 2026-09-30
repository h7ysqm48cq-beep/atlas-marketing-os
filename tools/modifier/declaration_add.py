from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportedDeclarationNode,
    ImportNode,
)
from .bridge_editor import (
    utf16_length,
    utf16_offset_to_python_index,
)


class DeclarationAddError(ValueError):
    """Base declaration addition error."""


class InvalidDeclarationAdd(
    DeclarationAddError
):
    """Raised when a declaration addition is invalid."""


class DeclarationAddConflict(
    DeclarationAddError
):
    """Raised when the declaration already exists."""


class DeclarationAddDirection(str, Enum):
    BEFORE = "before"
    AFTER = "after"
    TOP = "top"
    BOTTOM = "bottom"


@dataclass(frozen=True, slots=True)
class DeclarationAddEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class DeclarationAddPlan:
    edits: tuple[DeclarationAddEdit, ...]
    direction: DeclarationAddDirection
    declaration_name: str
    declaration_kind: str
    target_name: str | None


@dataclass(frozen=True, slots=True)
class DeclarationAddContext:
    source: str
    declaration_name: str
    declaration_kind: str
    declaration_text: str
    declarations: tuple[
        ExportedDeclarationNode,
        ...
    ]
    imports: tuple[
        ImportNode,
        ...
    ]
    before: str | None = None
    after: str | None = None
    position: str | None = None


class DeclarationAddPlanner:
    _KINDS = {
        "class",
        "function",
        "variable",
        "interface",
        "type",
        "enum",
    }

    def plan(
        self,
        context: DeclarationAddContext,
    ) -> DeclarationAddPlan:
        if not isinstance(
            context,
            DeclarationAddContext,
        ):
            raise TypeError(
                "context must be a "
                "DeclarationAddContext"
            )

        self._validate_context(context)

        declarations = tuple(
            sorted(
                context.declarations,
                key=lambda item:
                    item.declaration_start,
            )
        )

        self._validate_conflict(
            declarations,
            context.declaration_name,
        )

        direction, target_name, insert_index = (
            self._resolve_destination(
                declarations,
                before=context.before,
                after=context.after,
                position=context.position,
            )
        )

        declaration_text = (
            context.declaration_text
            .strip("\r\n")
        )

        if not declarations:
            edit = self._empty_region_edit(
                context.source,
                context.imports,
                declaration_text,
            )

            return DeclarationAddPlan(
                edits=(edit,),
                direction=direction,
                declaration_name=(
                    context.declaration_name
                ),
                declaration_kind=(
                    context.declaration_kind
                ),
                target_name=target_name,
            )

        block_infos = [
            self._declaration_block(
                context.source,
                declaration,
            )
            for declaration in declarations
        ]

        blocks = [
            item[2].strip("\r\n")
            for item in block_infos
        ]

        blocks.insert(
            insert_index,
            declaration_text,
        )

        region_start = min(
            item[0]
            for item in block_infos
        )

        region_end = max(
            item[1]
            for item in block_infos
        )

        replacement = "\n\n".join(
            blocks
        )

        original_region = context.source[
            utf16_offset_to_python_index(
                context.source,
                region_start,
            ):
            utf16_offset_to_python_index(
                context.source,
                region_end,
            )
        ]

        if original_region.endswith(
            ("\n", "\r")
        ):
            replacement += "\n"

        return DeclarationAddPlan(
            edits=(
                DeclarationAddEdit(
                    start=region_start,
                    end=region_end,
                    text=replacement,
                ),
            ),
            direction=direction,
            declaration_name=(
                context.declaration_name
            ),
            declaration_kind=(
                context.declaration_kind
            ),
            target_name=target_name,
        )

    def _validate_context(
        self,
        context: DeclarationAddContext,
    ) -> None:
        if (
            context.declaration_kind
            not in self._KINDS
        ):
            raise InvalidDeclarationAdd(
                "declaration_kind must be class, "
                "function, variable, interface, "
                "type, or enum"
            )

        if not context.declaration_name.strip():
            raise InvalidDeclarationAdd(
                "declaration_name cannot be empty"
            )

        if not context.declaration_text.strip():
            raise InvalidDeclarationAdd(
                "declaration_text cannot be empty"
            )

        options = (
            context.before is not None,
            context.after is not None,
            context.position is not None,
        )

        if sum(options) > 1:
            raise InvalidDeclarationAdd(
                "At most one of before, after or "
                "position may be provided"
            )

        if (
            context.position is not None
            and context.position
            not in {"top", "bottom"}
        ):
            raise InvalidDeclarationAdd(
                "position must be 'top' or 'bottom'"
            )

    @staticmethod
    def _validate_conflict(
        declarations: tuple[
            ExportedDeclarationNode,
            ...
        ],
        name: str,
    ) -> None:
        if any(
            declaration.contains_name(name)
            for declaration in declarations
        ):
            raise DeclarationAddConflict(
                f"A declaration named "
                f"{name!r} already exists"
            )

    def _resolve_destination(
        self,
        declarations: tuple[
            ExportedDeclarationNode,
            ...
        ],
        *,
        before: str | None,
        after: str | None,
        position: str | None,
    ) -> tuple[
        DeclarationAddDirection,
        str | None,
        int,
    ]:
        if before is not None:
            target_index = self._target_index(
                declarations,
                before,
            )

            return (
                DeclarationAddDirection.BEFORE,
                before,
                target_index,
            )

        if after is not None:
            target_index = self._target_index(
                declarations,
                after,
            )

            return (
                DeclarationAddDirection.AFTER,
                after,
                target_index + 1,
            )

        if position == "top":
            return (
                DeclarationAddDirection.TOP,
                None,
                0,
            )

        return (
            DeclarationAddDirection.BOTTOM,
            None,
            len(declarations),
        )

    @staticmethod
    def _target_index(
        declarations: tuple[
            ExportedDeclarationNode,
            ...
        ],
        name: str,
    ) -> int:
        matches = [
            index
            for index, declaration
            in enumerate(declarations)
            if declaration.contains_name(name)
        ]

        if not matches:
            raise InvalidDeclarationAdd(
                f"Target declaration {name!r} "
                "was not found"
            )

        if len(matches) > 1:
            raise InvalidDeclarationAdd(
                f"More than one target declaration "
                f"containing {name!r} was found"
            )

        return matches[0]

    @staticmethod
    def _empty_region_edit(
        source: str,
        imports: tuple[
            ImportNode,
            ...
        ],
        declaration_text: str,
    ) -> DeclarationAddEdit:
        if imports:
            last_import = max(
                imports,
                key=lambda item: item.end,
            )

            position = last_import.end

            python_position = (
                utf16_offset_to_python_index(
                    source,
                    position,
                )
            )

            suffix = source[
                python_position:
            ]

            if suffix.startswith(
                ("\r\n", "\n", "\r")
            ):
                text = (
                    "\n\n"
                    + declaration_text
                )
            else:
                text = (
                    "\n\n"
                    + declaration_text
                    + "\n"
                )

            return DeclarationAddEdit(
                start=position,
                end=position,
                text=text,
            )

        text = declaration_text

        if source:
            text += "\n\n"

        return DeclarationAddEdit(
            start=0,
            end=0,
            text=text,
        )

    def _declaration_block(
        self,
        source: str,
        declaration: ExportedDeclarationNode,
    ) -> tuple[int, int, str]:
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

        expanded_start = utf16_length(
            source[:expanded_python_start]
        )

        return (
            expanded_start,
            end,
            source[
                expanded_python_start:
                python_end
            ],
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

            stripped = previous_line.strip()

            if not stripped:
                break

            if stripped.startswith("//"):
                current_start = (
                    previous_line_start
                )
                continue

            if stripped.endswith("*/"):
                opening = source.rfind(
                    "/*",
                    0,
                    previous_line_end,
                )

                if opening < 0:
                    break

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
                    break

                current_start = (
                    opening_line_start
                )
                continue

            break

        return current_start
