from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.declaration_move import (
    DeclarationMoveContext,
    DeclarationMoveDirection,
    DeclarationMovePlanner,
    InvalidDeclarationMove,
    UnsupportedDeclarationMove,
)


def make_declaration(
    *,
    name: str,
    kind: str = "class",
    declaration_start: int,
    declaration_end: int,
    removal_start: int | None = None,
    removal_end: int | None = None,
    variable_declarators=(),
):
    return SimpleNamespace(
        name=name,
        kind=kind,
        declaration_start=declaration_start,
        declaration_end=declaration_end,
        removal_start=(
            declaration_start
            if removal_start is None
            else removal_start
        ),
        removal_end=(
            declaration_end
            if removal_end is None
            else removal_end
        ),
        variable_declarators=tuple(
            variable_declarators
        ),
        contains_name=lambda target: target == name,
    )


def declaration_from_text(
    source: str,
    *,
    name: str,
    text: str,
    kind: str = "class",
    variable_declarators=(),
):
    start = source.index(text)
    end = start + len(text)

    return make_declaration(
        name=name,
        kind=kind,
        declaration_start=start,
        declaration_end=end,
        removal_start=start,
        removal_end=end,
        variable_declarators=variable_declarators,
    )


def make_context(
    *,
    source: str,
    declaration,
    declarations,
    before=None,
    after=None,
    position=None,
) -> DeclarationMoveContext:
    return DeclarationMoveContext(
        source=source,
        declaration=declaration,
        declarations=tuple(declarations),
        before=before,
        after=after,
        position=position,
    )


class TestDeclarationMoveValidationBranches:
    def test_wrong_context_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="DeclarationMoveContext",
        ):
            DeclarationMovePlanner().plan(
                "invalid"
            )

    @pytest.mark.parametrize(
        "kwargs",
        (
            {},
            {
                "before": "First",
                "after": "Second",
            },
            {
                "before": "First",
                "position": "top",
            },
            {
                "after": "Second",
                "position": "bottom",
            },
        ),
    )
    def test_exactly_one_destination_required(
        self,
        kwargs,
    ) -> None:
        source = "class First {}"
        first = declaration_from_text(
            source,
            name="First",
            text=source,
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(first,),
            **kwargs,
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="Exactly one",
        ):
            DeclarationMovePlanner().plan(
                context
            )

    @pytest.mark.parametrize(
        "before",
        ("", "   ", 123),
    )
    def test_invalid_before_rejected(
        self,
        before,
    ) -> None:
        source = "class First {}"
        first = declaration_from_text(
            source,
            name="First",
            text=source,
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(first,),
            before=before,
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="before must be",
        ):
            DeclarationMovePlanner().plan(
                context
            )

    @pytest.mark.parametrize(
        "after",
        ("", "   ", 123),
    )
    def test_invalid_after_rejected(
        self,
        after,
    ) -> None:
        source = "class First {}"
        first = declaration_from_text(
            source,
            name="First",
            text=source,
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(first,),
            after=after,
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="after must be",
        ):
            DeclarationMovePlanner().plan(
                context
            )

    def test_invalid_position_rejected(
        self,
    ) -> None:
        source = "class First {}"
        first = declaration_from_text(
            source,
            name="First",
            text=source,
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(first,),
            position="middle",
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="position must be",
        ):
            DeclarationMovePlanner().plan(
                context
            )

    def test_empty_declarations_rejected(
        self,
    ) -> None:
        declaration = make_declaration(
            name="First",
            declaration_start=0,
            declaration_end=1,
        )

        context = make_context(
            source="x",
            declaration=declaration,
            declarations=(),
            position="top",
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="No declarations",
        ):
            DeclarationMovePlanner().plan(
                context
            )

    def test_source_declaration_must_be_present(
        self,
    ) -> None:
        source = "class First {}"

        first = declaration_from_text(
            source,
            name="First",
            text=source,
        )

        missing = make_declaration(
            name="Missing",
            declaration_start=0,
            declaration_end=1,
        )

        context = make_context(
            source=source,
            declaration=missing,
            declarations=(first,),
            position="top",
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="Source declaration is not present",
        ):
            DeclarationMovePlanner().plan(
                context
            )


class TestDeclarationSourceShapeBranches:
    def test_multi_variable_statement_rejected(
        self,
    ) -> None:
        declarators = (
            SimpleNamespace(
                destructuring=False,
                names=("first",),
            ),
            SimpleNamespace(
                destructuring=False,
                names=("second",),
            ),
        )

        declaration = make_declaration(
            name="first",
            kind="variable",
            declaration_start=0,
            declaration_end=10,
            variable_declarators=declarators,
        )

        with pytest.raises(
            UnsupportedDeclarationMove,
            match="multi-variable",
        ):
            DeclarationMovePlanner()._validate_source_shape(
                declaration
            )

    @pytest.mark.parametrize(
        "declarator",
        (
            SimpleNamespace(
                destructuring=True,
                names=("first",),
            ),
            SimpleNamespace(
                destructuring=False,
                names=("first", "second"),
            ),
        ),
    )
    def test_destructuring_variable_rejected(
        self,
        declarator,
    ) -> None:
        declaration = make_declaration(
            name="first",
            kind="variable",
            declaration_start=0,
            declaration_end=10,
            variable_declarators=(
                declarator,
            ),
        )

        with pytest.raises(
            UnsupportedDeclarationMove,
            match="destructuring",
        ):
            DeclarationMovePlanner()._validate_source_shape(
                declaration
            )

    def test_single_variable_allowed(
        self,
    ) -> None:
        declaration = make_declaration(
            name="first",
            kind="variable",
            declaration_start=0,
            declaration_end=10,
            variable_declarators=(
                SimpleNamespace(
                    destructuring=False,
                    names=("first",),
                ),
            ),
        )

        DeclarationMovePlanner()._validate_source_shape(
            declaration
        )


class TestDeclarationMoveNoopBranches:
    def test_before_itself_is_noop(
        self,
    ) -> None:
        source = (
            "class First {}\n\n"
            "class Second {}"
        )

        first = declaration_from_text(
            source,
            name="First",
            text="class First {}",
        )
        second = declaration_from_text(
            source,
            name="Second",
            text="class Second {}",
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(first, second),
            before="First",
        )

        assert (
            DeclarationMovePlanner().plan(
                context
            )
            is None
        )

    def test_after_itself_is_noop(
        self,
    ) -> None:
        source = (
            "class First {}\n\n"
            "class Second {}"
        )

        first = declaration_from_text(
            source,
            name="First",
            text="class First {}",
        )
        second = declaration_from_text(
            source,
            name="Second",
            text="class Second {}",
        )

        context = make_context(
            source=source,
            declaration=second,
            declarations=(first, second),
            after="Second",
        )

        assert (
            DeclarationMovePlanner().plan(
                context
            )
            is None
        )


class TestTargetLookupBranches:
    def test_missing_target_rejected(
        self,
    ) -> None:
        declaration = make_declaration(
            name="First",
            declaration_start=0,
            declaration_end=1,
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="was not found",
        ):
            DeclarationMovePlanner()._find_target(
                (declaration,),
                "Missing",
            )

    def test_duplicate_target_rejected(
        self,
    ) -> None:
        first = make_declaration(
            name="Shared",
            declaration_start=0,
            declaration_end=1,
        )

        second = make_declaration(
            name="Shared",
            declaration_start=2,
            declaration_end=3,
        )

        with pytest.raises(
            InvalidDeclarationMove,
            match="More than one",
        ):
            DeclarationMovePlanner()._find_target(
                (first, second),
                "Shared",
            )


class TestMoveFormattingBranches:
    def test_trailing_newline_is_preserved(
        self,
    ) -> None:
        source = (
            "class First {}\n\n"
            "class Second {}\n\n"
            "class Third {}\n"
        )

        first = declaration_from_text(
            source,
            name="First",
            text="class First {}\n\n",
        )
        second = declaration_from_text(
            source,
            name="Second",
            text="class Second {}\n\n",
        )
        third = declaration_from_text(
            source,
            name="Third",
            text="class Third {}\n",
        )

        context = make_context(
            source=source,
            declaration=first,
            declarations=(
                first,
                second,
                third,
            ),
            after="Third",
        )

        plan = DeclarationMovePlanner().plan(
            context
        )

        assert plan is not None
        assert (
            plan.direction
            == DeclarationMoveDirection.AFTER
        )
        assert plan.target_name == "Third"
        assert plan.edits[0].text.endswith(
            "\n"
        )

    def test_region_without_trailing_newline(
        self,
    ) -> None:
        source = (
            "class First {}\n\n"
            "class Second {}"
        )

        first = declaration_from_text(
            source,
            name="First",
            text="class First {}\n\n",
        )
        second = declaration_from_text(
            source,
            name="Second",
            text="class Second {}",
        )

        context = make_context(
            source=source,
            declaration=second,
            declarations=(first, second),
            position="top",
        )

        plan = DeclarationMovePlanner().plan(
            context
        )

        assert plan is not None
        assert not plan.edits[0].text.endswith(
            "\n"
        )


class TestLeadingCommentBranches:
    def test_source_start_returns_zero(
        self,
    ) -> None:
        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                "class First {}",
                0,
            )
            == 0
        )

    def test_line_comments_are_attached(
        self,
    ) -> None:
        source = (
            "// first\n"
            "// second\n"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == 0
        )

    def test_blank_line_stops_scan(
        self,
    ) -> None:
        source = (
            "// unrelated\n"
            "\n"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == declaration_start
        )

    def test_normal_code_stops_scan(
        self,
    ) -> None:
        source = (
            "const value = 1;\n"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == declaration_start
        )

    def test_crlf_comment_is_attached(
        self,
    ) -> None:
        source = (
            "// documentation\r\n"
            "class First {}\r\n"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == 0
        )

    def test_carriage_return_only_branch(
        self,
    ) -> None:
        source = (
            "// documentation\r"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == 0
        )

    def test_block_comment_without_opening_stops(
        self,
    ) -> None:
        source = (
            "*/\n"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == declaration_start
        )

    def test_inline_block_comment_stops(
        self,
    ) -> None:
        source = (
            "const value = 1; /* note */\n"
            "class First {}"
        )

        declaration_start = source.index(
            "class First {}"
        )

        assert (
            DeclarationMovePlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
            == declaration_start
        )


class TestBlockCommentHelperBranches:
    def test_missing_opening_returns_none(
        self,
    ) -> None:
        assert (
            DeclarationMovePlanner()
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
            DeclarationMovePlanner()
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
            DeclarationMovePlanner()
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
            DeclarationMovePlanner()
            ._block_comment_start(
                source,
                line_start,
                len(source),
            )
            == line_start
        )


class TestNormalizeBlockBranches:
    def test_empty_block_unchanged(
        self,
    ) -> None:
        assert (
            DeclarationMovePlanner()
            ._normalize_block("")
            == ""
        )

    @pytest.mark.parametrize(
        (
            "block",
            "expected",
        ),
        (
            (
                "class First {}",
                "class First {}\n\n",
            ),
            (
                "class First {}\n",
                "class First {}\n\n",
            ),
            (
                "class First {}\r\n",
                "class First {}\n\n",
            ),
        ),
    )
    def test_block_normalized(
        self,
        block: str,
        expected: str,
    ) -> None:
        assert (
            DeclarationMovePlanner()
            ._normalize_block(block)
            == expected
        )
