from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class ClassUpdateError(ValueError):
    """Base class update error."""


class InvalidClassUpdate(
    ClassUpdateError
):
    """Raised when a class update is invalid."""


@dataclass(frozen=True, slots=True)
class ClassUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class ClassUpdatePlan:
    edits: tuple[ClassUpdateEdit, ...]
    class_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class ClassUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    replacement_text: str


class ClassUpdatePlanner:
    def plan(
        self,
        context: ClassUpdateContext,
    ) -> ClassUpdatePlan:
        if not isinstance(
            context,
            ClassUpdateContext,
        ):
            raise TypeError(
                "context must be a "
                "ClassUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "class":
            raise InvalidClassUpdate(
                "Existing declaration must be "
                "a class"
            )

        if replacement.kind != "class":
            raise InvalidClassUpdate(
                "Replacement declaration must be "
                "a class"
            )

        if declaration.name is None:
            raise InvalidClassUpdate(
                "Anonymous existing classes are "
                "not supported"
            )

        if replacement.name is None:
            raise InvalidClassUpdate(
                "Anonymous replacement classes are "
                "not supported"
            )

        if (
            replacement.name
            != declaration.name
        ):
            raise InvalidClassUpdate(
                "Replacement class name does not "
                "match the existing class name: "
                f"{declaration.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidClassUpdate(
                "replacement_text cannot be empty"
            )

        return ClassUpdatePlan(
            edits=(
                ClassUpdateEdit(
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
            class_name=declaration.name,
            replacement_name=(
                replacement.name
            ),
        )
