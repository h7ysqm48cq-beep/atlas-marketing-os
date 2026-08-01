from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class VariableUpdateError(ValueError):
    """Base variable update error."""


class InvalidVariableUpdate(
    VariableUpdateError
):
    """Raised when a variable update is invalid."""


@dataclass(frozen=True, slots=True)
class VariableUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class VariableUpdatePlan:
    edits: tuple[VariableUpdateEdit, ...]
    variable_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class VariableUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    variable_name: str
    replacement_text: str


class VariableUpdatePlanner:
    def plan(
        self,
        context: VariableUpdateContext,
    ) -> VariableUpdatePlan:
        if not isinstance(
            context,
            VariableUpdateContext,
        ):
            raise TypeError(
                "context must be a "
                "VariableUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "variable":
            raise InvalidVariableUpdate(
                "Existing declaration must be "
                "a variable"
            )

        if replacement.kind != "variable":
            raise InvalidVariableUpdate(
                "Replacement declaration must be "
                "a variable"
            )

        existing_declarators = (
            declaration.variable_declarators
        )

        replacement_declarators = (
            replacement.variable_declarators
        )

        if len(existing_declarators) != 1:
            raise InvalidVariableUpdate(
                "Updating one variable from a "
                "multi-variable statement is not "
                "supported in v1"
            )

        if len(replacement_declarators) != 1:
            raise InvalidVariableUpdate(
                "Replacement must contain exactly "
                "one variable declarator"
            )

        existing = existing_declarators[0]
        new = replacement_declarators[0]

        if (
            existing.destructuring
            or len(existing.names) != 1
        ):
            raise InvalidVariableUpdate(
                "Updating destructuring variable "
                "declarations is not supported"
            )

        if (
            new.destructuring
            or len(new.names) != 1
        ):
            raise InvalidVariableUpdate(
                "Replacement destructuring variable "
                "declarations are not supported"
            )

        existing_name = existing.names[0]
        replacement_name = new.names[0]

        if existing_name != context.variable_name:
            raise InvalidVariableUpdate(
                "Existing variable declarator does "
                "not match the requested name"
            )

        if replacement_name != existing_name:
            raise InvalidVariableUpdate(
                "Replacement variable name does not "
                "match the existing variable name: "
                f"{existing_name!r} != "
                f"{replacement_name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidVariableUpdate(
                "replacement_text cannot be empty"
            )

        return VariableUpdatePlan(
            edits=(
                VariableUpdateEdit(
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
            variable_name=existing_name,
            replacement_name=(
                replacement_name
            ),
        )
