from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class TypeAliasUpdateError(ValueError):
    """Base type alias update error."""


class InvalidTypeAliasUpdate(
    TypeAliasUpdateError
):
    """Raised when a type alias update is invalid."""


@dataclass(frozen=True, slots=True)
class TypeAliasUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class TypeAliasUpdatePlan:
    edits: tuple[TypeAliasUpdateEdit, ...]
    type_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class TypeAliasUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    replacement_text: str


class TypeAliasUpdatePlanner:
    def plan(
        self,
        context: TypeAliasUpdateContext,
    ) -> TypeAliasUpdatePlan:
        if not isinstance(
            context,
            TypeAliasUpdateContext,
        ):
            raise TypeError(
                "context must be a "
                "TypeAliasUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "type":
            raise InvalidTypeAliasUpdate(
                "Existing declaration must be "
                "a type alias"
            )

        if replacement.kind != "type":
            raise InvalidTypeAliasUpdate(
                "Replacement declaration must be "
                "a type alias"
            )

        if declaration.name is None:
            raise InvalidTypeAliasUpdate(
                "Anonymous existing type aliases "
                "are not supported"
            )

        if replacement.name is None:
            raise InvalidTypeAliasUpdate(
                "Anonymous replacement type aliases "
                "are not supported"
            )

        if (
            declaration.name
            != replacement.name
        ):
            raise InvalidTypeAliasUpdate(
                "Replacement type alias name does "
                "not match the existing type alias "
                f"name: {declaration.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidTypeAliasUpdate(
                "replacement_text cannot be empty"
            )

        return TypeAliasUpdatePlan(
            edits=(
                TypeAliasUpdateEdit(
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
            type_name=declaration.name,
            replacement_name=(
                replacement.name
            ),
        )
