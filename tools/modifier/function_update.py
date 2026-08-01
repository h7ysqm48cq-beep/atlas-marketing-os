from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class FunctionUpdateError(ValueError):
    """Base function update error."""


class InvalidFunctionUpdate(
    FunctionUpdateError
):
    """Raised when a function update is invalid."""


@dataclass(frozen=True, slots=True)
class FunctionUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class FunctionUpdatePlan:
    edits: tuple[FunctionUpdateEdit, ...]
    function_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class FunctionUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    replacement_text: str


class FunctionUpdatePlanner:
    def plan(
        self,
        context: FunctionUpdateContext,
    ) -> FunctionUpdatePlan:
        if not isinstance(
            context,
            FunctionUpdateContext,
        ):
            raise TypeError(
                "context must be a "
                "FunctionUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "function":
            raise InvalidFunctionUpdate(
                "Existing declaration must be "
                "a function"
            )

        if replacement.kind != "function":
            raise InvalidFunctionUpdate(
                "Replacement declaration must be "
                "a function"
            )

        if declaration.name is None:
            raise InvalidFunctionUpdate(
                "Anonymous existing functions are "
                "not supported"
            )

        if replacement.name is None:
            raise InvalidFunctionUpdate(
                "Anonymous replacement functions "
                "are not supported"
            )

        if (
            replacement.name
            != declaration.name
        ):
            raise InvalidFunctionUpdate(
                "Replacement function name does not "
                "match the existing function name: "
                f"{declaration.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidFunctionUpdate(
                "replacement_text cannot be empty"
            )

        return FunctionUpdatePlan(
            edits=(
                FunctionUpdateEdit(
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
            function_name=declaration.name,
            replacement_name=(
                replacement.name
            ),
        )
