from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.member_move import (
    InvalidMemberMove,
    MemberMoveContext,
    MemberMoveDirection,
    MemberMovePlanner,
)


def make_member(
    *,
    name: str,
    kind: str = "method",
    member_start: int,
    member_end: int,
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


def member_from_text(
    source: str,
    name: str,
    text: str,
    *,
    kind: str = "method",
):
    start = source.index(text)
    end = start + len(text)

    name_start = source.index(name, start, end)

    return make_member(
        name=name,
        kind=kind,
        member_start=name_start,
        member_end=name_start + len(name),
        removal_start=start,
        removal_end=end,
    )


def make_context(
    *,
    source: str,
    member,
    members,
    before=None,
    after=None,
    position=None,
) -> MemberMoveContext:
    return MemberMoveContext(
        source=source,
        member=member,
        members=tuple(members),
        before=before,
        after=after,
        position=position,
    )


class TestMemberMoveValidationBranches:
    def test_wrong_context_type_rejected(self) -> None:
        with pytest.raises(
            TypeError,
            match="MemberMoveContext",
        ):
            MemberMovePlanner().plan("invalid")

    @pytest.mark.parametrize(
        "kwargs",
        (
            {},
            {
                "before": "first",
                "after": "second",
            },
            {
                "before": "first",
                "position": "top",
            },
            {
                "after": "second",
                "position": "bottom",
            },
        ),
    )
    def test_exactly_one_destination_required(
        self,
        kwargs,
    ) -> None:
        source = "first(): void {}"
        first = member_from_text(
            source,
            "first",
            source,
        )

        context = make_context(
            source=source,
            member=first,
            members=(first,),
            **kwargs,
        )

        with pytest.raises(
            InvalidMemberMove,
            match="Exactly one",
        ):
            MemberMovePlanner().plan(context)

    @pytest.mark.parametrize(
        "before",
        ("", "   ", 123),
    )
    def test_invalid_before_rejected(
        self,
        before,
    ) -> None:
        source = "first(): void {}"
        first = member_from_text(
            source,
            "first",
            source,
        )

        context = make_context(
            source=source,
            member=first,
            members=(first,),
            before=before,
        )

        with pytest.raises(
            InvalidMemberMove,
            match="before must be",
        ):
            MemberMovePlanner().plan(context)

    @pytest.mark.parametrize(
        "after",
        ("", "   ", 123),
    )
    def test_invalid_after_rejected(
        self,
        after,
    ) -> None:
        source = "first(): void {}"
        first = member_from_text(
            source,
            "first",
            source,
        )

        context = make_context(
            source=source,
            member=first,
            members=(first,),
            after=after,
        )

        with pytest.raises(
            InvalidMemberMove,
            match="after must be",
        ):
            MemberMovePlanner().plan(context)

    def test_invalid_position_rejected(self) -> None:
        source = "first(): void {}"
        first = member_from_text(
            source,
            "first",
            source,
        )

        context = make_context(
            source=source,
            member=first,
            members=(first,),
            position="middle",
        )

        with pytest.raises(
            InvalidMemberMove,
            match="position must be",
        ):
            MemberMovePlanner().plan(context)

    def test_empty_member_collection_rejected(
        self,
    ) -> None:
        member = make_member(
            name="first",
            member_start=0,
            member_end=5,
        )

        context = make_context(
            source="first",
            member=member,
            members=(),
            position="top",
        )

        with pytest.raises(
            InvalidMemberMove,
            match="No class members",
        ):
            MemberMovePlanner().plan(context)

    def test_source_member_must_be_present(
        self,
    ) -> None:
        source = (
            "first(): void {}\n"
            "second(): void {}"
        )

        first = member_from_text(
            source,
            "first",
            "first(): void {}",
        )

        missing = make_member(
            name="missing",
            member_start=0,
            member_end=1,
            removal_start=0,
            removal_end=1,
        )

        context = make_context(
            source=source,
            member=missing,
            members=(first,),
            position="top",
        )

        with pytest.raises(
            InvalidMemberMove,
            match="Source member is not present",
        ):
            MemberMovePlanner().plan(context)


class TestMemberMoveNoopBranches:
    def test_before_itself_is_noop(self) -> None:
        source = (
            "first(): void {}\n\n"
            "second(): void {}"
        )

        first = member_from_text(
            source,
            "first",
            "first(): void {}",
        )
        second = member_from_text(
            source,
            "second",
            "second(): void {}",
        )

        context = make_context(
            source=source,
            member=first,
            members=(first, second),
            before="first",
        )

        assert MemberMovePlanner().plan(
            context
        ) is None

    def test_after_itself_is_noop(self) -> None:
        source = (
            "first(): void {}\n\n"
            "second(): void {}"
        )

        first = member_from_text(
            source,
            "first",
            "first(): void {}",
        )
        second = member_from_text(
            source,
            "second",
            "second(): void {}",
        )

        context = make_context(
            source=source,
            member=second,
            members=(first, second),
            after="second",
        )

        assert MemberMovePlanner().plan(
            context
        ) is None


class TestTargetLookupBranches:
    def test_missing_target_rejected(self) -> None:
        member = make_member(
            name="first",
            member_start=0,
            member_end=5,
        )

        with pytest.raises(
            InvalidMemberMove,
            match="was not found",
        ):
            MemberMovePlanner()._find_target(
                (member,),
                "missing",
            )

    def test_duplicate_target_rejected(self) -> None:
        first = make_member(
            name="active",
            kind="getter",
            member_start=0,
            member_end=6,
        )
        second = make_member(
            name="active",
            kind="setter",
            member_start=10,
            member_end=16,
        )

        with pytest.raises(
            InvalidMemberMove,
            match="More than one",
        ):
            MemberMovePlanner()._find_target(
                (first, second),
                "active",
            )


class TestMovePlanFormattingBranches:
    def test_move_after_creates_after_plan(
        self,
    ) -> None:
        source = (
            "first(): void {}\n\n"
            "second(): void {}\n\n"
            "third(): void {}\n"
        )

        first = member_from_text(
            source,
            "first",
            "first(): void {}\n\n",
        )
        second = member_from_text(
            source,
            "second",
            "second(): void {}\n\n",
        )
        third = member_from_text(
            source,
            "third",
            "third(): void {}\n",
        )

        context = make_context(
            source=source,
            member=first,
            members=(first, second, third),
            after="third",
        )

        plan = MemberMovePlanner().plan(
            context
        )

        assert plan is not None
        assert (
            plan.direction
            == MemberMoveDirection.AFTER
        )
        assert plan.target_name == "third"
        assert plan.edits[0].text.endswith("\n")

    def test_region_without_trailing_newline(
        self,
    ) -> None:
        source = (
            "first(): void {}\n\n"
            "second(): void {}"
        )

        first = member_from_text(
            source,
            "first",
            "first(): void {}\n\n",
        )
        second = member_from_text(
            source,
            "second",
            "second(): void {}",
        )

        context = make_context(
            source=source,
            member=second,
            members=(first, second),
            position="top",
        )

        plan = MemberMovePlanner().plan(
            context
        )

        assert plan is not None
        assert not plan.edits[0].text.endswith(
            "\n"
        )


class TestLeadingCommentBranches:
    def test_source_start_returns_zero(self) -> None:
        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                "run(): void {}",
                0,
            )
            == 0
        )

    def test_line_comments_attached(self) -> None:
        source = (
            "// first\n"
            "// second\n"
            "run(): void {}"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == 0
        )

    def test_blank_line_stops_comment_scan(
        self,
    ) -> None:
        source = (
            "// unrelated\n"
            "\n"
            "run(): void {}"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_normal_code_stops_scan(self) -> None:
        source = (
            "value = 1;\n"
            "run(): void {}"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_crlf_line_comment_attached(
        self,
    ) -> None:
        source = (
            "// documentation\r\n"
            "run(): void {}\r\n"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == 0
        )

    def test_block_comment_without_opening_stops(
        self,
    ) -> None:
        source = (
            "*/\n"
            "run(): void {}"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_inline_block_comment_stops(
        self,
    ) -> None:
        source = (
            "value = 1; /* note */\n"
            "run(): void {}"
        )

        member_start = source.index(
            "run(): void {}"
        )

        assert (
            MemberMovePlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )


class TestBlockCommentHelperBranches:
    def test_missing_opening_returns_none(
        self,
    ) -> None:
        assert (
            MemberMovePlanner()
            ._block_comment_start(
                "*/",
                0,
                2,
            )
            is None
        )

    def test_missing_closing_returns_none(
        self,
    ) -> None:
        source = "/* open only"

        assert (
            MemberMovePlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            is None
        )

    def test_inline_opening_returns_none(
        self,
    ) -> None:
        source = "value = 1; /* note */"

        assert (
            MemberMovePlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            is None
        )

    def test_valid_block_returns_line_start(
        self,
    ) -> None:
        source = (
            "before\n"
            "  /* note */"
        )

        line_start = len("before\n")

        assert (
            MemberMovePlanner()
            ._block_comment_start(
                source,
                line_start,
                len(source),
            )
            == line_start
        )


def test_carriage_return_only_comment_branch() -> None:
    source = (
        "// documentation\r"
        "run(): void {}"
    )

    member_start = source.index(
        "run(): void {}"
    )

    result = (
        MemberMovePlanner()
        ._leading_comment_start(
            source,
            member_start,
        )
    )

    assert result == 0
