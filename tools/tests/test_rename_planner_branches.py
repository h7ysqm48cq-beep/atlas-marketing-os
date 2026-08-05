from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.declaration_rename import (
    DeclarationRenameContext,
    DeclarationRenameError,
    DeclarationRenamePlanner,
)
from tools.modifier.member_rename import (
    MemberRenameContext,
    MemberRenameError,
    MemberRenamePlanner,
)


def make_declaration_symbol(
    *,
    name: str = "alpha",
    kind: str = "function",
    occurrences: tuple[object, ...] = (),
):
    return SimpleNamespace(
        name=name,
        kind=kind,
        occurrences=occurrences,
    )


def make_member_symbol(
    *,
    name: str = "run",
    kind: str = "method",
    class_name: str = "UserService",
    occurrences: tuple[object, ...] = (),
):
    return SimpleNamespace(
        name=name,
        kind=kind,
        class_name=class_name,
        occurrences=occurrences,
    )


class TestDeclarationRenameBranches:
    def test_wrong_context_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="DeclarationRenameContext",
        ):
            DeclarationRenamePlanner().plan(
                "invalid"
            )

    def test_empty_occurrences_rejected(
        self,
    ) -> None:
        context = DeclarationRenameContext(
            symbol=make_declaration_symbol(
                occurrences=(),
            ),
            new_name="beta",
            existing_declaration_names=(
                "alpha",
            ),
        )

        with pytest.raises(
            DeclarationRenameError,
            match="no rename locations",
        ):
            DeclarationRenamePlanner().plan(
                context
            )


class TestMemberRenameBranches:
    def test_wrong_context_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="MemberRenameContext",
        ):
            MemberRenamePlanner().plan(
                "invalid"
            )

    def test_empty_occurrences_rejected(
        self,
    ) -> None:
        context = MemberRenameContext(
            symbol=make_member_symbol(
                occurrences=(),
            ),
            new_name="execute",
            existing_member_names=(
                "run",
            ),
        )

        with pytest.raises(
            MemberRenameError,
            match="no member rename locations",
        ):
            MemberRenamePlanner().plan(
                context
            )
