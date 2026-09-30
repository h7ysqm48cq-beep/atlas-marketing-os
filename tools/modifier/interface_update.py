from __future__ import annotations

from dataclasses import dataclass

from .ast_navigator import (
    ExportedDeclarationNode,
)


class InterfaceUpdateError(ValueError):
    """Base interface update error."""


class InvalidInterfaceUpdate(
    InterfaceUpdateError
):
    """Raised when an interface update is invalid."""


@dataclass(frozen=True, slots=True)
class InterfaceUpdateEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class InterfaceUpdatePlan:
    edits: tuple[InterfaceUpdateEdit, ...]
    interface_name: str
    replacement_name: str


@dataclass(frozen=True, slots=True)
class InterfaceUpdateContext:
    declaration: ExportedDeclarationNode
    replacement: ExportedDeclarationNode
    replacement_text: str


class InterfaceUpdatePlanner:
    def plan(
        self,
        context: InterfaceUpdateContext,
    ) -> InterfaceUpdatePlan:
        if not isinstance(
            context,
            InterfaceUpdateContext,
        ):
            raise TypeError(
                "context must be an "
                "InterfaceUpdateContext"
            )

        declaration = context.declaration
        replacement = context.replacement

        if declaration.kind != "interface":
            raise InvalidInterfaceUpdate(
                "Existing declaration must be "
                "an interface"
            )

        if replacement.kind != "interface":
            raise InvalidInterfaceUpdate(
                "Replacement declaration must be "
                "an interface"
            )

        if declaration.name is None:
            raise InvalidInterfaceUpdate(
                "Anonymous existing interfaces "
                "are not supported"
            )

        if replacement.name is None:
            raise InvalidInterfaceUpdate(
                "Anonymous replacement interfaces "
                "are not supported"
            )

        if (
            declaration.name
            != replacement.name
        ):
            raise InvalidInterfaceUpdate(
                "Replacement interface name does "
                "not match the existing interface "
                f"name: {declaration.name!r} != "
                f"{replacement.name!r}"
            )

        replacement_text = (
            context.replacement_text
            .strip("\r\n")
        )

        if not replacement_text.strip():
            raise InvalidInterfaceUpdate(
                "replacement_text cannot be empty"
            )

        return InterfaceUpdatePlan(
            edits=(
                InterfaceUpdateEdit(
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
            interface_name=(
                declaration.name
            ),
            replacement_name=(
                replacement.name
            ),
        )
