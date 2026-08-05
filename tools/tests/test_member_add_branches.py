from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.member_add import (
    InvalidMemberAdd,
    MemberAddConflict,
    MemberAddContext,
    MemberAddDirection,
    MemberAddPlanner,
)


def make_member(
    *,
    name: str,
    kind: str = "method",
    member_start: int = 0,
    member_end: int = 0,
    removal_start: int | None = None,
    removal_end: int | None = None,
):
    return SimpleNamespace(
        name=name,
        kind=kind,
        member_start=member_start,
        member_end=member_end,
        removal_start=(
            member_start
            if removal_start is None
            else removal_start
        ),
        removal_end=(
            member_end
            if removal_end is None
            else removal_end
        ),
    )


def make_class(
    *,
    members=(),
    class_start: int = 0,
    class_end: int = 0,
):
    return SimpleNamespace(
        class_start=class_start,
        class_end=class_end,
        members=lambda: tuple(members),
    )


def make_context(
    *,
    source: str = "class UserService {}\n",
    members=(),
    member_name: str = "login",
    member_kind: str = "method",
    member_text: str = "login(): void {}",
    before: str | None = None,
    after: str | None = None,
    position: str | None = None,
    class_start: int = 0,
    class_end: int | None = None,
) -> MemberAddContext:
    if class_end is None:
        class_end = len(source.rstrip("\n"))

    return MemberAddContext(
        source=source,
        class_node=make_class(
            members=members,
            class_start=class_start,
            class_end=class_end,
        ),
        member_name=member_name,
        member_kind=member_kind,
        member_text=member_text,
        before=before,
        after=after,
        position=position,
    )


class TestMemberAddContextBranches:
    def test_wrong_context_type_rejected(self) -> None:
        with pytest.raises(
            TypeError,
            match="MemberAddContext",
        ):
            MemberAddPlanner().plan("invalid")

    def test_invalid_member_kind_rejected(self) -> None:
        context = make_context(
            member_kind="unknown",
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="member_kind must be",
        ):
            MemberAddPlanner().plan(context)

    def test_empty_member_name_rejected(self) -> None:
        context = make_context(
            member_name="   ",
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="member_name cannot be empty",
        ):
            MemberAddPlanner().plan(context)

    def test_empty_member_text_rejected(self) -> None:
        context = make_context(
            member_text="\n\t",
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="member_text cannot be empty",
        ):
            MemberAddPlanner().plan(context)

    def test_multiple_destination_options_rejected(
        self,
    ) -> None:
        context = make_context(
            before="first",
            after="second",
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="At most one",
        ):
            MemberAddPlanner().plan(context)

    def test_invalid_position_rejected(self) -> None:
        context = make_context(
            position="middle",
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="position must be",
        ):
            MemberAddPlanner().plan(context)


class TestMemberConflictBranches:
    def test_getter_allowed_with_existing_setter(
        self,
    ) -> None:
        members = (
            make_member(
                name="active",
                kind="setter",
            ),
        )

        MemberAddPlanner()._validate_conflict(
            members,
            "active",
            "getter",
        )

    def test_setter_allowed_with_existing_getter(
        self,
    ) -> None:
        members = (
            make_member(
                name="active",
                kind="getter",
            ),
        )

        MemberAddPlanner()._validate_conflict(
            members,
            "active",
            "setter",
        )

    def test_getter_conflicts_with_method_same_name(
        self,
    ) -> None:
        members = (
            make_member(
                name="active",
                kind="method",
            ),
        )

        with pytest.raises(
            MemberAddConflict,
            match="conflicting member",
        ):
            MemberAddPlanner()._validate_conflict(
                members,
                "active",
                "getter",
            )


class TestDestinationBranches:
    def test_top_destination(self) -> None:
        direction, target, index = (
            MemberAddPlanner()._resolve_destination(
                (),
                before=None,
                after=None,
                position="top",
            )
        )

        assert direction == MemberAddDirection.TOP
        assert target is None
        assert index == 0

    def test_bottom_destination(self) -> None:
        members = (
            make_member(name="first"),
            make_member(name="second"),
        )

        direction, target, index = (
            MemberAddPlanner()._resolve_destination(
                members,
                before=None,
                after=None,
                position=None,
            )
        )

        assert direction == MemberAddDirection.BOTTOM
        assert target is None
        assert index == 2

    def test_missing_target_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberAdd,
            match="was not found",
        ):
            MemberAddPlanner()._target_index(
                (
                    make_member(name="first"),
                ),
                "missing",
            )

    def test_ambiguous_target_rejected(self) -> None:
        with pytest.raises(
            InvalidMemberAdd,
            match="More than one target",
        ):
            MemberAddPlanner()._target_index(
                (
                    make_member(name="active"),
                    make_member(
                        name="active",
                        kind="getter",
                    ),
                ),
                "active",
            )


class TestEmptyClassEditBranches:
    def test_empty_class_with_existing_newline(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "}\n"
        )

        context = make_context(
            source=source,
            class_end=source.index("}") + 1,
        )

        plan = MemberAddPlanner().plan(context)

        assert plan.edits[0].text == (
            "  login(): void {}\n"
        )

    def test_empty_class_without_newline_before_brace(
        self,
    ) -> None:
        source = "class UserService {}\n"

        context = make_context(
            source=source,
            class_end=source.index("}") + 1,
        )

        plan = MemberAddPlanner().plan(context)

        assert plan.edits[0].text == (
            "\n"
            "  login(): void {}\n"
        )

    def test_missing_closing_brace_rejected(
        self,
    ) -> None:
        source = "class UserService {"

        context = make_context(
            source=source,
            class_end=len(source),
        )

        with pytest.raises(
            InvalidMemberAdd,
            match="closing brace",
        ):
            MemberAddPlanner().plan(context)


class TestExistingMemberRegionBranches:
    def test_original_region_trailing_newline_preserved(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  first(): void {}\n"
            "}\n"
        )

        member_text = "  first(): void {}\n"
        start = source.index(member_text)
        end = start + len(member_text)

        members = (
            make_member(
                name="first",
                member_start=start,
                member_end=end,
                removal_start=start,
                removal_end=end,
            ),
        )

        context = make_context(
            source=source,
            members=members,
            class_end=source.rindex("}") + 1,
        )

        plan = MemberAddPlanner().plan(context)

        assert plan.edits[0].text.endswith("\n")


class TestLeadingCommentBranches:
    def test_multiple_line_comments_are_included(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  // first\n"
            "  // second\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == source.index(
            "  // first"
        )

    def test_block_comment_is_included(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  /* documentation\n"
            "   * details\n"
            "   */\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == source.index(
            "  /* documentation"
        )

    def test_block_comment_without_opening_stops(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  */\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == member_start

    def test_inline_block_comment_stops(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  const marker = 1; /* note */\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == member_start

    def test_blank_line_stops_comment_scan(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  // unrelated\n"
            "\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == member_start

    def test_normal_code_line_stops_scan(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  value = 1;\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == member_start

    def test_member_at_source_start(self) -> None:
        assert (
            MemberAddPlanner()
            ._leading_comment_start(
                "run(): void {}",
                0,
            )
            == 0
        )


class TestMemberAddCarriageReturnBranches:
    def test_original_region_trailing_carriage_return_preserved(
        self,
    ) -> None:
        source = (
            "class UserService {\r"
            "  first(): void {}\r"
            "}\r"
        )

        member_text = "  first(): void {}\r"
        start = source.index(member_text)
        end = start + len(member_text)

        members = (
            make_member(
                name="first",
                member_start=start,
                member_end=end,
                removal_start=start,
                removal_end=end,
            ),
        )

        context = make_context(
            source=source,
            members=members,
            class_end=source.rindex("}") + 1,
        )

        plan = MemberAddPlanner().plan(context)

        assert plan.edits[0].text.endswith("\n")

    def test_leading_comment_with_crlf(
        self,
    ) -> None:
        source = (
            "class UserService {\r\n"
            "  // documentation\r\n"
            "  run(): void {}\r\n"
            "}\r\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == source.index(
            "  // documentation"
        )

    def test_leading_comment_with_carriage_return_only(
        self,
    ) -> None:
        source = (
            "class UserService {\r"
            "  // documentation\r"
            "  run(): void {}\r"
            "}\r"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        result = (
            MemberAddPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
        )

        assert result == member_start


def test_existing_member_region_without_trailing_newline() -> None:
    source = (
        "class UserService {\n"
        "  first(): void {}"
        "}\n"
    )

    member_text = "  first(): void {}"
    start = source.index(member_text)
    end = start + len(member_text)

    members = (
        make_member(
            name="first",
            member_start=start,
            member_end=end,
            removal_start=start,
            removal_end=end,
        ),
    )

    context = make_context(
        source=source,
        members=members,
        class_end=source.rindex("}") + 1,
    )

    plan = MemberAddPlanner().plan(context)

    assert not plan.edits[0].text.endswith("\n")
