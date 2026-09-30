from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class EnumUpdateError(ValueError):
    """Base enum update error."""


class InvalidEnumUpdate(
    EnumUpdateError
):
    """Raised when an enum update is invalid."""


@dataclass(frozen=True, slots=True)
class EnumUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class EnumUpdatePlan:
    edits: tuple[EnumUpdateEdit, ...]
    enum_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class EnumUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    replacement_text: str


class EnumUpdatePlanner:
    def plan(
        self,
        context: EnumUpdateContext,
    ) -> EnumUpdatePlan:
        if not isinstance(
            context,
            EnumUpdateContext,
        ):
            raise TypeError(
                "context must be an "
                "EnumUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "enum":
            raise InvalidEnumUpdate(
                "Existing declaration must be "
                "an enum"
            )

        if replacement.kind != "enum":
            raise InvalidEnumUpdate(
                "Replacement declaration must be "
                "an enum"
            )

        if declaration.name is None:
            raise InvalidEnumUpdate(
                "Anonymous existing enums are "
                "not supported"
            )

        if replacement.name is None:
            raise InvalidEnumUpdate(
                "Anonymous replacement enums are "
                "not supported"
            )

        if (
            declaration.name
            != replacement.name
        ):
            raise InvalidEnumUpdate(
                "Replacement enum name does not "
                "match the existing enum name: "
                f"{declaration.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidEnumUpdate(
                "replacement_text cannot be empty"
            )

        return EnumUpdatePlan(
            edits=(
                EnumUpdateEdit(
                    start=(
                        declaration
                        .declaration_start
                    ),
                    end=(
                        declaration
                        .declaration_end
                    ),
                    text=replacement_text,
                ),
            ),
            enum_name=declaration.name,
            replacement_name=(
                replacement.name
            ),
        )
