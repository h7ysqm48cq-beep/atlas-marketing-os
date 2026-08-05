from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.member_removal import (
    MemberRemovalContext,
    MemberRemovalPlanner,
    MemberStillReferenced,
    UnsupportedMemberRemoval,
)


def make_member(
    *,
    name: str = "run",
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


def make_occurrence(start: int, end: int):
    return SimpleNamespace(
        start=start,
        end=end,
    )


def make_symbol(*occurrences):
    return SimpleNamespace(
        occurrences=tuple(occurrences),
    )


def make_context(
    *,
    source: str,
    members,
    member,
    class_start: int = 0,
    class_end: int | None = None,
    symbol=None,
    declaration_ranges=(),
    force: bool = False,
) -> MemberRemovalContext:
    if class_end is None:
        class_end = len(source.rstrip("\n"))

    return MemberRemovalContext(
        source=source,
        class_name="UserService",
        class_node=make_class(
            members=members,
            class_start=class_start,
            class_end=class_end,
        ),
        member=member,
        symbol=symbol,
        declaration_ranges=tuple(
            declaration_ranges
        ),
        force=force,
    )


class TestMemberRemovalValidation:
    def test_wrong_context_type_rejected(self) -> None:
        with pytest.raises(
            TypeError,
            match="MemberRemovalContext",
        ):
            MemberRemovalPlanner().plan(
                "invalid"
            )

    def test_source_must_be_string(self) -> None:
        member = make_member()

        context = MemberRemovalContext(
            source=123,
            class_name="UserService",
            class_node=make_class(
                members=(member,),
            ),
            member=member,
            symbol=None,
            declaration_ranges=(),
        )

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            MemberRemovalPlanner().plan(
                context
            )

    def test_force_must_be_boolean(self) -> None:
        member = make_member()

        context = MemberRemovalContext(
            source="class UserService {}\n",
            class_name="UserService",
            class_node=make_class(
                members=(member,),
                class_end=20,
            ),
            member=member,
            symbol=None,
            declaration_ranges=(),
            force="yes",
        )

        with pytest.raises(
            TypeError,
            match="force must be a boolean",
        ):
            MemberRemovalPlanner().plan(
                context
            )

    def test_referenced_member_rejected(self) -> None:
        source = (
            "class UserService {\n"
            "  run(): void {}\n"
            "}\n"
        )

        start = source.index("run")
        member = make_member(
            member_start=start,
            member_end=start + 3,
            removal_start=source.index("  run"),
            removal_end=source.index("}\n"),
        )

        context = make_context(
            source=source,
            members=(member,),
            member=member,
            class_end=source.rindex("}") + 1,
            symbol=make_symbol(
                make_occurrence(
                    start,
                    start + 3,
                ),
                make_occurrence(
                    len(source),
                    len(source) + 3,
                ),
            ),
            declaration_ranges=(
                (start, start + 3),
            ),
        )

        with pytest.raises(
            MemberStillReferenced,
            match="still has 1",
        ):
            MemberRemovalPlanner().plan(
                context
            )

    def test_force_allows_referenced_member(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  run(): void {}\n"
            "}\n"
        )

        start = source.index("run")
        member = make_member(
            member_start=start,
            member_end=start + 3,
        )

        context = make_context(
            source=source,
            members=(member,),
            member=member,
            class_end=source.rindex("}") + 1,
            symbol=make_symbol(
                make_occurrence(100, 103),
            ),
            force=True,
        )

        plan = MemberRemovalPlanner().plan(
            context
        )

        assert plan.reference_count == 1
        assert plan.forced is True


class TestEmptyClassEditBranches:
    @pytest.mark.parametrize(
        "source",
        (
            "class UserService\n",
            "class UserService {\n",
            "class UserService }\n",
            "class UserService } {\n",
        ),
    )
    def test_invalid_class_braces_rejected(
        self,
        source: str,
    ) -> None:
        class_node = make_class(
            class_start=0,
            class_end=len(source),
        )

        with pytest.raises(
            UnsupportedMemberRemoval,
            match="class body braces",
        ):
            MemberRemovalPlanner()._empty_class_edit(
                source,
                class_node,
            )

    def test_only_member_collapses_class_body(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  run(): void {}\n"
            "}\n"
        )

        start = source.index("run")
        member = make_member(
            member_start=start,
            member_end=start + 3,
        )

        context = make_context(
            source=source,
            members=(member,),
            member=member,
            class_end=source.rindex("}") + 1,
        )

        plan = MemberRemovalPlanner().plan(
            context
        )

        edit = plan.edits[0]

        assert edit.text == "{}"
        assert plan.member_name == "run"
        assert plan.kind == "method"


class TestMemberRemovalRangeBranches:
    def test_member_not_present_rejected(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  first(): void {}\n"
            "}\n"
        )

        existing = make_member(
            name="first",
            member_start=source.index("first"),
            member_end=source.index("first") + 5,
        )

        missing = make_member(
            name="missing",
            member_start=0,
            member_end=1,
            removal_start=0,
            removal_end=1,
        )

        class_node = make_class(
            members=(existing,),
            class_end=source.rindex("}") + 1,
        )

        with pytest.raises(
            UnsupportedMemberRemoval,
            match="not present",
        ):
            MemberRemovalPlanner()._member_removal_range(
                source,
                class_node,
                missing,
            )

    @pytest.mark.parametrize(
        (
            "separator",
            "expected_adjustment",
        ),
        (
            ("\r\n\r\n", 2),
            ("\n\n", 1),
            ("\r\r", 1),
        ),
    )
    def test_final_member_consumes_separator(
        self,
        separator: str,
        expected_adjustment: int,
    ) -> None:
        source = (
            "class UserService {"
            + separator
            + "  run(): void {}"
            + separator[:1]
            + "}"
        )

        member_text = "  run(): void {}"
        start = source.index(member_text)
        end = start + len(member_text)

        member = make_member(
            member_start=start,
            member_end=end,
            removal_start=start,
            removal_end=end,
        )

        class_node = make_class(
            members=(member,),
            class_end=len(source),
        )

        removal_start, removal_end = (
            MemberRemovalPlanner()
            ._member_removal_range(
                source,
                class_node,
                member,
            )
        )

        assert removal_end == end
        assert removal_start == (
            start - expected_adjustment
        )

    def test_non_final_member_keeps_separator(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  first(): void {}\n\n"
            "  second(): void {}\n"
            "}\n"
        )

        first_text = "  first(): void {}"
        second_text = "  second(): void {}"

        first_start = source.index(first_text)
        first_end = first_start + len(first_text)
        second_start = source.index(second_text)
        second_end = second_start + len(second_text)

        first = make_member(
            name="first",
            member_start=first_start,
            member_end=first_end,
            removal_start=first_start,
            removal_end=first_end,
        )
        second = make_member(
            name="second",
            member_start=second_start,
            member_end=second_end,
            removal_start=second_start,
            removal_end=second_end,
        )

        class_node = make_class(
            members=(first, second),
            class_end=source.rindex("}") + 1,
        )

        start, end = (
            MemberRemovalPlanner()
            ._member_removal_range(
                source,
                class_node,
                first,
            )
        )

        assert start == first_start
        assert end == first_end


class TestLeadingCommentBranches:
    def test_line_comments_are_included(
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
            MemberRemovalPlanner()
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
            MemberRemovalPlanner()
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

        assert (
            MemberRemovalPlanner()
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
            "class UserService {\n"
            "  value = 1; /* note */\n"
            "  run(): void {}\n"
            "}\n"
        )

        member_start = source.index(
            "  run(): void {}"
        )

        assert (
            MemberRemovalPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_blank_line_stops_scan(
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

        assert (
            MemberRemovalPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_normal_code_stops_scan(
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

        assert (
            MemberRemovalPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == member_start
        )

    def test_crlf_is_processed(
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

        assert (
            MemberRemovalPlanner()
            ._leading_comment_start(
                source,
                member_start,
            )
            == source.index(
                "  // documentation"
            )
        )

    def test_source_start_returns_zero(
        self,
    ) -> None:
        assert (
            MemberRemovalPlanner()
            ._leading_comment_start(
                "run(): void {}",
                0,
            )
            == 0
        )


class TestBlockCommentHelperBranches:
    def test_missing_opening_returns_none(
        self,
    ) -> None:
        assert (
            MemberRemovalPlanner()
            ._block_comment_start(
                "*/",
                2,
            )
            is None
        )

    def test_missing_closing_returns_none(
        self,
    ) -> None:
        source = "/* open only"

        assert (
            MemberRemovalPlanner()
            ._block_comment_start(
                source,
                len(source),
            )
            is None
        )

    def test_inline_opening_returns_none(
        self,
    ) -> None:
        source = "value = 1; /* note */"

        assert (
            MemberRemovalPlanner()
            ._block_comment_start(
                source,
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

        assert (
            MemberRemovalPlanner()
            ._block_comment_start(
                source,
                len(source),
            )
            == len("before\n")
        )


class TestReferenceCountBranches:
    def test_none_symbol_has_zero_references(
        self,
    ) -> None:
        assert (
            MemberRemovalPlanner()
            ._reference_count(
                None,
                (),
            )
            == 0
        )

    def test_declaration_ranges_are_excluded(
        self,
    ) -> None:
        symbol = make_symbol(
            make_occurrence(10, 13),
            make_occurrence(20, 23),
            make_occurrence(30, 33),
        )

        count = (
            MemberRemovalPlanner()
            ._reference_count(
                symbol,
                (
                    (10, 13),
                    (30, 33),
                ),
            )
        )

        assert count == 1


class TestMemberRemovalRemainingBranches:
    def test_plan_removes_member_from_multi_member_class(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  first(): void {}\n\n"
            "  second(): void {}\n"
            "}\n"
        )

        first_text = "  first(): void {}"
        second_text = "  second(): void {}"

        first_start = source.index(first_text)
        first_end = first_start + len(first_text)

        second_start = source.index(second_text)
        second_end = second_start + len(second_text)

        first = make_member(
            name="first",
            member_start=first_start,
            member_end=first_end,
            removal_start=first_start,
            removal_end=first_end,
        )

        second = make_member(
            name="second",
            member_start=second_start,
            member_end=second_end,
            removal_start=second_start,
            removal_end=second_end,
        )

        context = make_context(
            source=source,
            members=(first, second),
            member=first,
            class_end=source.rindex("}") + 1,
        )

        plan = MemberRemovalPlanner().plan(
            context
        )

        assert plan.edits[0].start == first_start
        assert plan.edits[0].end == first_end
        assert plan.member_name == "first"
        assert plan.reference_count == 0
        assert plan.forced is False

    def test_final_member_without_blank_separator(
        self,
    ) -> None:
        source = (
            "class UserService {\n"
            "  first(): void {}\n"
            "  second(): void {}\n"
            "}\n"
        )

        first_text = "  first(): void {}"
        second_text = "  second(): void {}"

        first_start = source.index(first_text)
        first_end = first_start + len(first_text)

        second_start = source.index(second_text)
        second_end = second_start + len(second_text)

        first = make_member(
            name="first",
            member_start=first_start,
            member_end=first_end,
            removal_start=first_start,
            removal_end=first_end,
        )

        second = make_member(
            name="second",
            member_start=second_start,
            member_end=second_end,
            removal_start=second_start,
            removal_end=second_end,
        )

        class_node = make_class(
            members=(first, second),
            class_end=source.rindex("}") + 1,
        )

        start, end = (
            MemberRemovalPlanner()
            ._member_removal_range(
                source,
                class_node,
                second,
            )
        )

        assert start == second_start
        assert end == second_end
