from __future__ import annotations

import re
from dataclasses import dataclass

from .ast_navigator import (
    MemberRenameSymbolNode,
)
from .declaration_rename import (
    TYPESCRIPT_RESERVED_WORDS,
)


IDENTIFIER_PATTERN = re.compile(
    r"^[A-Za-z_$][A-Za-z0-9_$]*$"
)


class MemberRenameError(ValueError):
    """Base member rename error."""


class InvalidMemberName(
    MemberRenameError
):
    """Raised when a member name is invalid."""


class MemberRenameConflict(
    MemberRenameError
):
    """Raised when the replacement already exists."""


@dataclass(frozen=True, slots=True)
class MemberRenameEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class MemberRenamePlan:
    edits: tuple[MemberRenameEdit, ...]
    class_name: str
    old_name: str
    new_name: str
    kind: str


@dataclass(frozen=True, slots=True)
class MemberRenameContext:
    symbol: MemberRenameSymbolNode
    new_name: str
    existing_member_names: tuple[str, ...]


class MemberRenamePlanner:
    def plan(
        self,
        context: MemberRenameContext,
    ) -> MemberRenamePlan | None:
        if not isinstance(
            context,
            MemberRenameContext,
        ):
            raise TypeError(
                "context must be a "
                "MemberRenameContext"
            )

        new_name = context.new_name

        if (
            not IDENTIFIER_PATTERN.fullmatch(
                new_name
            )
            or new_name
            in TYPESCRIPT_RESERVED_WORDS
        ):
            raise InvalidMemberName(
                f"{new_name!r} is not a supported "
                "TypeScript member identifier"
            )

        old_name = context.symbol.name

        if old_name == new_name:
            return None

        conflicting_names = {
            name
            for name
            in context.existing_member_names
            if name != old_name
        }

        if new_name in conflicting_names:
            raise MemberRenameConflict(
                f"Class {context.symbol.class_name!r} "
                f"already contains a member named "
                f"{new_name!r}"
            )

        occurrences = (
            context.symbol.occurrences
        )

        if not occurrences:
            raise MemberRenameError(
                "TypeScript Language Service "
                "returned no member rename locations"
            )

        edits = tuple(
            MemberRenameEdit(
                start=occurrence.start,
                end=occurrence.end,
                text=new_name,
            )
            for occurrence in occurrences
        )

        return MemberRenamePlan(
            edits=edits,
            class_name=(
                context.symbol.class_name
            ),
            old_name=old_name,
            new_name=new_name,
            kind=context.symbol.kind,
        )
