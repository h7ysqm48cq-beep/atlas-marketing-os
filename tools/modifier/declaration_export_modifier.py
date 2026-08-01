from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .ast_navigator import (
    ExportedDeclarationNode,
)


class DeclarationExportError(ValueError):
    """Base declaration export planning error."""


class InvalidDeclarationExport(
    DeclarationExportError
):
    """Raised for an unsupported declaration export."""


class DeclarationExportShape(
    str,
    Enum,
):
    ADD_EXPORT = "add_declaration_export"
    ADD_DEFAULT = "add_declaration_default"
    ADD_EXPORT_DEFAULT = (
        "add_declaration_export_default"
    )
    REMOVE_EXPORT = "remove_declaration_export"
    REMOVE_DEFAULT = "remove_declaration_default"
    REMOVE_EXPORT_DEFAULT = (
        "remove_declaration_export_default"
    )


@dataclass(frozen=True, slots=True)
class DeclarationExportEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class DeclarationExportPlan:
    edits: tuple[DeclarationExportEdit, ...]
    shape: DeclarationExportShape


@dataclass(frozen=True, slots=True)
class DeclarationExportContext:
    source: str
    declaration: ExportedDeclarationNode
    default: bool = False
    remove: bool = False
    default_only: bool = False


def _python_index(
    source: str,
    utf16_offset: int,
) -> int:
    if utf16_offset < 0:
        raise InvalidDeclarationExport(
            "Offset cannot be negative"
        )

    consumed = 0

    for index, character in enumerate(source):
        if consumed == utf16_offset:
            return index

        consumed += (
            2
            if ord(character) > 0xFFFF
            else 1
        )

        if consumed > utf16_offset:
            raise InvalidDeclarationExport(
                "Offset splits a UTF-16 code unit"
            )

    if consumed == utf16_offset:
        return len(source)

    raise InvalidDeclarationExport(
        "Offset exceeds source length"
    )


def _utf16_length(
    value: str,
) -> int:
    return len(
        value.encode("utf-16-le")
    ) // 2


def _consume_horizontal_space_right(
    source: str,
    offset: int,
) -> int:
    index = _python_index(
        source,
        offset,
    )

    while (
        index < len(source)
        and source[index] in {" ", "\t"}
    ):
        index += 1

    return _utf16_length(
        source[:index]
    )


def _remove_modifier_edit(
    source: str,
    start: int,
    end: int,
) -> DeclarationExportEdit:
    expanded_end = (
        _consume_horizontal_space_right(
            source,
            end,
        )
    )

    if expanded_end > end:
        return DeclarationExportEdit(
            start=start,
            end=expanded_end,
            text="",
        )

    start_index = _python_index(
        source,
        start,
    )

    if (
        start_index > 0
        and source[start_index - 1]
        in {" ", "\t"}
    ):
        prefix = source[:start_index]

        trimmed = prefix.rstrip(
            " \t"
        )

        adjusted_start = _utf16_length(
            trimmed
        )

        return DeclarationExportEdit(
            start=adjusted_start,
            end=end,
            text="",
        )

    return DeclarationExportEdit(
        start=start,
        end=end,
        text="",
    )


def _validate_default_kind(
    declaration: ExportedDeclarationNode,
) -> None:
    if declaration.kind not in {
        "class",
        "function",
    }:
        raise InvalidDeclarationExport(
            "Default declaration export is only "
            "supported for class and function "
            "declarations"
        )


class DeclarationExportPlanner:
    """Plan export modifier edits for a declaration."""

    def plan(
        self,
        context: DeclarationExportContext,
    ) -> DeclarationExportPlan | None:
        if not isinstance(
            context,
            DeclarationExportContext,
        ):
            raise TypeError(
                "context must be a "
                "DeclarationExportContext"
            )

        declaration = context.declaration

        if context.default_only and not context.remove:
            raise InvalidDeclarationExport(
                "default_only requires remove=True"
            )

        if context.remove:
            return self._plan_remove(
                context
            )

        if context.default:
            _validate_default_kind(
                declaration
            )

        if declaration.exported:
            if not context.default:
                return None

            if declaration.default:
                return None

            export_end = (
                declaration.export_modifier_end
            )

            if export_end is None:
                raise InvalidDeclarationExport(
                    "Exported declaration is missing "
                    "its export modifier offset"
                )

            return DeclarationExportPlan(
                edits=(
                    DeclarationExportEdit(
                        start=export_end,
                        end=export_end,
                        text=" default",
                    ),
                ),
                shape=(
                    DeclarationExportShape
                    .ADD_DEFAULT
                ),
            )

        text = (
            "export default "
            if context.default
            else "export "
        )

        return DeclarationExportPlan(
            edits=(
                DeclarationExportEdit(
                    start=(
                        declaration
                        .modifier_start
                    ),
                    end=(
                        declaration
                        .modifier_start
                    ),
                    text=text,
                ),
            ),
            shape=(
                DeclarationExportShape
                .ADD_EXPORT_DEFAULT
                if context.default
                else DeclarationExportShape
                .ADD_EXPORT
            ),
        )

    def _plan_remove(
        self,
        context: DeclarationExportContext,
    ) -> DeclarationExportPlan | None:
        declaration = context.declaration

        if context.default_only:
            if not declaration.default:
                return None

            start = (
                declaration.default_modifier_start
            )
            end = (
                declaration.default_modifier_end
            )

            if start is None or end is None:
                raise InvalidDeclarationExport(
                    "Default declaration is missing "
                    "default modifier offsets"
                )

            return DeclarationExportPlan(
                edits=(
                    _remove_modifier_edit(
                        context.source,
                        start,
                        end,
                    ),
                ),
                shape=(
                    DeclarationExportShape
                    .REMOVE_DEFAULT
                ),
            )

        if not declaration.exported:
            return None

        export_start = (
            declaration.export_modifier_start
        )
        export_end = (
            declaration.export_modifier_end
        )

        if (
            export_start is None
            or export_end is None
        ):
            raise InvalidDeclarationExport(
                "Exported declaration is missing "
                "export modifier offsets"
            )

        if declaration.default:
            default_start = (
                declaration.default_modifier_start
            )
            default_end = (
                declaration.default_modifier_end
            )

            if (
                default_start is None
                or default_end is None
            ):
                raise InvalidDeclarationExport(
                    "Default declaration is missing "
                    "default modifier offsets"
                )

            combined_end = (
                _consume_horizontal_space_right(
                    context.source,
                    default_end,
                )
            )

            return DeclarationExportPlan(
                edits=(
                    DeclarationExportEdit(
                        start=export_start,
                        end=combined_end,
                        text="",
                    ),
                ),
                shape=(
                    DeclarationExportShape
                    .REMOVE_EXPORT_DEFAULT
                ),
            )

        return DeclarationExportPlan(
            edits=(
                _remove_modifier_edit(
                    context.source,
                    export_start,
                    export_end,
                ),
            ),
            shape=(
                DeclarationExportShape
                .REMOVE_EXPORT
            ),
        )
