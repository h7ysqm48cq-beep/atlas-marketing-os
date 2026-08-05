from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.declaration_removal import (
    DeclarationRemovalContext,
    DeclarationRemovalPlanner,
    DeclarationRemovalShape,
    DeclarationStillReferenced,
    UnsupportedDeclarationRemoval,
)


def make_declarator(
    *,
    names: tuple[str, ...] = ("alpha",),
    destructuring: bool = False,
    removal_start: int = 0,
    removal_end: int = 1,
):
    return SimpleNamespace(
        names=names,
        destructuring=destructuring,
        removal_start=removal_start,
        removal_end=removal_end,
    )


def make_declaration(
    *,
    kind: str = "class",
    removal_start: int = 0,
    removal_end: int = 1,
    declarators: tuple[object, ...] = (),
    selected_declarator: object | None = None,
):
    return SimpleNamespace(
        kind=kind,
        removal_start=removal_start,
        removal_end=removal_end,
        variable_declarators=declarators,
        variable_declarator=(
            lambda name: selected_declarator
        ),
    )


def make_occurrence(
    start: int,
    end: int,
):
    return SimpleNamespace(
        start=start,
        end=end,
    )


def make_symbol(
    *,
    identifier_start: int = 0,
    identifier_end: int = 5,
    occurrences: tuple[object, ...] = (),
):
    return SimpleNamespace(
        identifier_start=identifier_start,
        identifier_end=identifier_end,
        occurrences=occurrences,
    )


def make_context(
    *,
    source: str = "class Alpha {}",
    declaration: object | None = None,
    symbol: object | None = None,
    name: str = "Alpha",
    force: bool = False,
) -> DeclarationRemovalContext:
    if declaration is None:
        declaration = make_declaration(
            removal_start=0,
            removal_end=len(source),
        )

    return DeclarationRemovalContext(
        source=source,
        declaration=declaration,
        symbol=symbol,
        name=name,
        force=force,
    )


class TestValidationBranches:
    def test_context_type_rejected(self) -> None:
        with pytest.raises(
            TypeError,
            match="DeclarationRemovalContext",
        ):
            DeclarationRemovalPlanner().plan(
                "invalid"
            )

    def test_source_type_rejected(self) -> None:
        context = make_context()

        context = DeclarationRemovalContext(
            source=123,
            declaration=context.declaration,
            symbol=None,
            name="Alpha",
        )

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            DeclarationRemovalPlanner().plan(
                context
            )

    def test_force_type_rejected(self) -> None:
        context = DeclarationRemovalContext(
            source="class Alpha {}",
            declaration=make_declaration(
                removal_start=0,
                removal_end=14,
            ),
            symbol=None,
            name="Alpha",
            force="yes",
        )

        with pytest.raises(
            TypeError,
            match="force must be a boolean",
        ):
            DeclarationRemovalPlanner().plan(
                context
            )


class TestReferenceBranches:
    def test_none_symbol_has_no_references(
        self,
    ) -> None:
        assert (
            DeclarationRemovalPlanner()
            ._reference_count(None)
            == 0
        )

    def test_declaration_occurrence_excluded(
        self,
    ) -> None:
        symbol = make_symbol(
            identifier_start=10,
            identifier_end=15,
            occurrences=(
                make_occurrence(10, 15),
            ),
        )

        assert (
            DeclarationRemovalPlanner()
            ._reference_count(symbol)
            == 0
        )

    def test_semantic_references_counted(
        self,
    ) -> None:
        symbol = make_symbol(
            identifier_start=10,
            identifier_end=15,
            occurrences=(
                make_occurrence(10, 15),
                make_occurrence(30, 35),
                make_occurrence(50, 55),
            ),
        )

        assert (
            DeclarationRemovalPlanner()
            ._reference_count(symbol)
            == 2
        )

    def test_referenced_declaration_rejected(
        self,
    ) -> None:
        source = "class Alpha {}"

        symbol = make_symbol(
            identifier_start=6,
            identifier_end=11,
            occurrences=(
                make_occurrence(6, 11),
                make_occurrence(20, 25),
            ),
        )

        with pytest.raises(
            DeclarationStillReferenced,
            match="still has 1",
        ):
            DeclarationRemovalPlanner().plan(
                make_context(
                    source=source,
                    symbol=symbol,
                )
            )

    def test_force_allows_referenced_removal(
        self,
    ) -> None:
        source = "class Alpha {}"

        symbol = make_symbol(
            identifier_start=6,
            identifier_end=11,
            occurrences=(
                make_occurrence(6, 11),
                make_occurrence(20, 25),
            ),
        )

        plan = DeclarationRemovalPlanner().plan(
            make_context(
                source=source,
                symbol=symbol,
                force=True,
            )
        )

        assert plan.reference_count == 1
        assert plan.forced is True


class TestVariableBranches:
    def test_variable_declarator_not_found(
        self,
    ) -> None:
        declaration = make_declaration(
            kind="variable",
            declarators=(),
            selected_declarator=None,
        )

        with pytest.raises(
            UnsupportedDeclarationRemoval,
            match="was not found",
        ):
            DeclarationRemovalPlanner().plan(
                make_context(
                    source="const alpha = 1;",
                    declaration=declaration,
                    name="alpha",
                )
            )

    def test_destructuring_rejected(self) -> None:
        declarator = make_declarator(
            names=("alpha", "beta"),
            destructuring=True,
        )

        declaration = make_declaration(
            kind="variable",
            declarators=(declarator,),
            selected_declarator=declarator,
        )

        with pytest.raises(
            UnsupportedDeclarationRemoval,
            match="destructuring",
        ):
            DeclarationRemovalPlanner().plan(
                make_context(
                    source=(
                        "const { alpha, beta } "
                        "= value;"
                    ),
                    declaration=declaration,
                    name="alpha",
                )
            )

    def test_multiple_names_rejected(self) -> None:
        declarator = make_declarator(
            names=("alpha", "beta"),
            destructuring=False,
        )

        declaration = make_declaration(
            kind="variable",
            declarators=(declarator,),
            selected_declarator=declarator,
        )

        with pytest.raises(
            UnsupportedDeclarationRemoval,
            match="destructuring",
        ):
            DeclarationRemovalPlanner().plan(
                make_context(
                    source="const alpha = 1;",
                    declaration=declaration,
                    name="alpha",
                )
            )

    def test_single_variable_removes_statement(
        self,
    ) -> None:
        source = "const alpha = 1;"

        declarator = make_declarator(
            names=("alpha",),
            removal_start=6,
            removal_end=len(source),
        )

        declaration = make_declaration(
            kind="variable",
            removal_start=0,
            removal_end=len(source),
            declarators=(declarator,),
            selected_declarator=declarator,
        )

        plan = DeclarationRemovalPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                name="alpha",
            )
        )

        assert (
            plan.shape
            == DeclarationRemovalShape.STATEMENT
        )
        assert plan.edits[0].start == 0
        assert plan.edits[0].end == len(source)

    def test_multi_variable_removes_declarator(
        self,
    ) -> None:
        source = "const alpha = 1, beta = 2;"

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        alpha = make_declarator(
            names=("alpha",),
            removal_start=alpha_start,
            removal_end=beta_start,
        )

        beta = make_declarator(
            names=("beta",),
            removal_start=beta_start,
            removal_end=len(source),
        )

        declaration = make_declaration(
            kind="variable",
            removal_start=0,
            removal_end=len(source),
            declarators=(alpha, beta),
            selected_declarator=alpha,
        )

        plan = DeclarationRemovalPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                name="alpha",
            )
        )

        assert (
            plan.shape
            == DeclarationRemovalShape
            .VARIABLE_DECLARATOR
        )
        assert (
            plan.edits[0].start
            == alpha_start
        )
        assert (
            plan.edits[0].end
            == beta_start
        )


class TestFinalStatementSeparators:
    def test_final_statement_removes_crlf_separator(
        self,
    ) -> None:
        source = (
            "class First {}\r\n"
            "\r\n"
            "class Second {}"
        )

        start = source.index("class Second")

        declaration = make_declaration(
            removal_start=start,
            removal_end=len(source),
        )

        result = (
            DeclarationRemovalPlanner()
            ._statement_removal_range(
                source,
                declaration,
            )
        )

        assert result[0] == start - 2
        assert result[1] == len(source)

    def test_final_statement_removes_lf_separator(
        self,
    ) -> None:
        source = (
            "class First {}\n"
            "\n"
            "class Second {}"
        )

        start = source.index("class Second")

        declaration = make_declaration(
            removal_start=start,
            removal_end=len(source),
        )

        result = (
            DeclarationRemovalPlanner()
            ._statement_removal_range(
                source,
                declaration,
            )
        )

        assert result[0] == start - 1

    def test_final_statement_removes_cr_separator(
        self,
    ) -> None:
        source = (
            "class First {}\r"
            "\r"
            "class Second {}"
        )

        start = source.index("class Second")

        declaration = make_declaration(
            removal_start=start,
            removal_end=len(source),
        )

        result = (
            DeclarationRemovalPlanner()
            ._statement_removal_range(
                source,
                declaration,
            )
        )

        assert result[0] == start - 1

    def test_nonfinal_statement_keeps_prefix(
        self,
    ) -> None:
        source = (
            "class First {}\n\n"
            "class Second {}\n"
        )

        end = source.index("\n\n")

        declaration = make_declaration(
            removal_start=0,
            removal_end=end,
        )

        result = (
            DeclarationRemovalPlanner()
            ._statement_removal_range(
                source,
                declaration,
            )
        )

        assert result == (0, end)


class TestLeadingCommentBranches:
    def test_line_comment_attached(self) -> None:
        source = (
            "// Documentation.\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == 0

    def test_multiple_line_comments_attached(
        self,
    ) -> None:
        source = (
            "// First.\n"
            "// Second.\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == 0

    def test_blank_line_stops_scan(self) -> None:
        source = (
            "// Detached.\n"
            "\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == start

    def test_crlf_line_comment_attached(
        self,
    ) -> None:
        source = (
            "// Documentation.\r\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == 0

    def test_block_comment_attached(self) -> None:
        source = (
            "/*\n"
            " * Documentation.\n"
            " */\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == 0

    def test_block_comment_without_opening_stops(
        self,
    ) -> None:
        source = (
            " */\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == start

    def test_inline_block_comment_not_attached(
        self,
    ) -> None:
        source = (
            "const marker = true; /* docs */\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == start

    def test_noncomment_line_stops_scan(
        self,
    ) -> None:
        source = (
            "const marker = true;\n"
            "class Alpha {}"
        )

        start = source.index("class Alpha")

        result = (
            DeclarationRemovalPlanner()
            ._leading_comment_start(
                source,
                start,
            )
        )

        assert result == start


class TestBlockCommentHelper:
    def test_opening_not_found(self) -> None:
        source = " */"

        assert (
            DeclarationRemovalPlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            is None
        )

    def test_closing_not_in_range(self) -> None:
        source = "/* documentation"

        assert (
            DeclarationRemovalPlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            is None
        )

    def test_inline_prefix_rejected(self) -> None:
        source = (
            "const value = 1; "
            "/* documentation */"
        )

        assert (
            DeclarationRemovalPlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            is None
        )

    def test_valid_block_comment_start(self) -> None:
        source = (
            "/* documentation */"
        )

        assert (
            DeclarationRemovalPlanner()
            ._block_comment_start(
                source,
                0,
                len(source),
            )
            == 0
        )

    def test_multiline_block_comment_start(
        self,
    ) -> None:
        source = (
            "header\n"
            "/*\n"
            " * documentation\n"
            " */"
        )

        opening_line = source.index("/*")

        assert (
            DeclarationRemovalPlanner()
            ._block_comment_start(
                source,
                source.rfind("\n") + 1,
                len(source),
            )
            == opening_line
        )
