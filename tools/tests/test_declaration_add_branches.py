from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ExportedDeclarationNode,
    ImportNode,
)
from tools.modifier.declaration_add import (
    DeclarationAddConflict,
    DeclarationAddContext,
    DeclarationAddDirection,
    DeclarationAddPlanner,
    InvalidDeclarationAdd,
)


def make_declaration(
    *,
    name: str,
    kind: str = "class",
    start: int = 0,
    end: int = 1,
    removal_start: int | None = None,
    removal_end: int | None = None,
) -> ExportedDeclarationNode:
    return ExportedDeclarationNode(
        raw={
            "kind": kind,
            "name": name,
            "names": [name],
            "exported": False,
            "default": False,
            "declarationStart": start,
            "declarationEnd": end,
            "modifierStart": start,
            "removalStart": (
                start
                if removal_start is None
                else removal_start
            ),
            "removalEnd": (
                end
                if removal_end is None
                else removal_end
            ),
            "variableDeclarators": [],
            "start": start,
            "end": end,
            "startLine": 1,
            "startColumn": 1,
            "endLine": 1,
            "endColumn": 1,
        }
    )


def make_import(
    *,
    start: int,
    end: int,
    module: str = "./shared",
) -> ImportNode:
    return ImportNode(
        raw={
            "module": module,
            "quoteStyle": "'",
            "sideEffectOnly": False,
            "defaultImport": "Shared",
            "namespaceImport": None,
            "namedImports": [],
            "typeOnly": False,
            "importClauseStart": start,
            "importClauseEnd": end,
            "namedBindingsStart": None,
            "namedBindingsEnd": None,
            "moduleSpecifierStart": start,
            "moduleSpecifierEnd": end,
            "start": start,
            "end": end,
            "startLine": 1,
            "startColumn": 1,
            "endLine": 1,
            "endColumn": 1,
        }
    )


def make_context(
    *,
    source: str = "",
    declaration_name: str = "Beta",
    declaration_kind: str = "class",
    declaration_text: str = "class Beta {}",
    declarations: tuple[
        ExportedDeclarationNode,
        ...
    ] = (),
    imports: tuple[ImportNode, ...] = (),
    before: str | None = None,
    after: str | None = None,
    position: str | None = None,
) -> DeclarationAddContext:
    return DeclarationAddContext(
        source=source,
        declaration_name=declaration_name,
        declaration_kind=declaration_kind,
        declaration_text=declaration_text,
        declarations=declarations,
        imports=imports,
        before=before,
        after=after,
        position=position,
    )


class TestPlannerValidation:
    def test_wrong_context_type(self) -> None:
        with pytest.raises(
            TypeError,
            match="DeclarationAddContext",
        ):
            DeclarationAddPlanner().plan(
                "invalid"
            )

    def test_invalid_kind_rejected(self) -> None:
        with pytest.raises(
            InvalidDeclarationAdd,
            match="declaration_kind",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    declaration_kind="namespace",
                )
            )

    def test_empty_name_rejected(self) -> None:
        with pytest.raises(
            InvalidDeclarationAdd,
            match="declaration_name",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    declaration_name=" ",
                )
            )

    def test_empty_text_rejected(self) -> None:
        with pytest.raises(
            InvalidDeclarationAdd,
            match="declaration_text",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    declaration_text="\n\r ",
                )
            )

    def test_multiple_destination_options_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationAdd,
            match="At most one",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    before="Alpha",
                    after="Gamma",
                )
            )

    def test_invalid_position_rejected(self) -> None:
        with pytest.raises(
            InvalidDeclarationAdd,
            match="position must be",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    position="middle",
                )
            )


class TestConflictAndTargetBranches:
    def test_existing_name_conflict(self) -> None:
        existing = make_declaration(
            name="Beta",
        )

        with pytest.raises(
            DeclarationAddConflict,
            match="already exists",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    declarations=(existing,),
                )
            )

    def test_missing_before_target_rejected(
        self,
    ) -> None:
        existing = make_declaration(
            name="Alpha",
        )

        with pytest.raises(
            InvalidDeclarationAdd,
            match="was not found",
        ):
            DeclarationAddPlanner().plan(
                make_context(
                    declarations=(existing,),
                    before="Missing",
                )
            )

    def test_ambiguous_target_rejected(self) -> None:
        first = make_declaration(
            name="Alpha",
            start=0,
            end=10,
        )
        second = make_declaration(
            name="Alpha",
            start=20,
            end=30,
        )

        with pytest.raises(
            InvalidDeclarationAdd,
            match="More than one target",
        ):
            DeclarationAddPlanner()._target_index(
                (first, second),
                "Alpha",
            )


class TestDestinationBranches:
    def test_before_destination(self) -> None:
        alpha = make_declaration(
            name="Alpha",
        )

        result = (
            DeclarationAddPlanner()
            ._resolve_destination(
                (alpha,),
                before="Alpha",
                after=None,
                position=None,
            )
        )

        assert result == (
            DeclarationAddDirection.BEFORE,
            "Alpha",
            0,
        )

    def test_after_destination(self) -> None:
        alpha = make_declaration(
            name="Alpha",
        )

        result = (
            DeclarationAddPlanner()
            ._resolve_destination(
                (alpha,),
                before=None,
                after="Alpha",
                position=None,
            )
        )

        assert result == (
            DeclarationAddDirection.AFTER,
            "Alpha",
            1,
        )

    def test_top_destination(self) -> None:
        result = (
            DeclarationAddPlanner()
            ._resolve_destination(
                (),
                before=None,
                after=None,
                position="top",
            )
        )

        assert result == (
            DeclarationAddDirection.TOP,
            None,
            0,
        )

    def test_bottom_destination(self) -> None:
        alpha = make_declaration(
            name="Alpha",
        )

        result = (
            DeclarationAddPlanner()
            ._resolve_destination(
                (alpha,),
                before=None,
                after=None,
                position=None,
            )
        )

        assert result == (
            DeclarationAddDirection.BOTTOM,
            None,
            1,
        )


class TestEmptyRegionBranches:
    def test_empty_file_insertion(self) -> None:
        edit = (
            DeclarationAddPlanner()
            ._empty_region_edit(
                "",
                (),
                "class Beta {}",
            )
        )

        assert edit.start == 0
        assert edit.end == 0
        assert edit.text == "class Beta {}"

    def test_nonempty_file_without_declarations(
        self,
    ) -> None:
        edit = (
            DeclarationAddPlanner()
            ._empty_region_edit(
                "// header\n",
                (),
                "class Beta {}",
            )
        )

        assert edit.text == (
            "class Beta {}\n\n"
        )

    def test_after_import_with_existing_newline(
        self,
    ) -> None:
        source = (
            "import Shared from './shared';\n"
            "const marker = true;\n"
        )

        end = source.index("\n")

        import_node = make_import(
            start=0,
            end=end,
        )

        edit = (
            DeclarationAddPlanner()
            ._empty_region_edit(
                source,
                (import_node,),
                "class Beta {}",
            )
        )

        assert edit.start == end
        assert edit.text == (
            "\n\nclass Beta {}"
        )

    def test_after_import_without_newline(
        self,
    ) -> None:
        source = (
            "import Shared from './shared';"
        )

        import_node = make_import(
            start=0,
            end=len(source),
        )

        edit = (
            DeclarationAddPlanner()
            ._empty_region_edit(
                source,
                (import_node,),
                "class Beta {}",
            )
        )

        assert edit.text == (
            "\n\nclass Beta {}\n"
        )


class TestExistingRegionBranches:
    def test_original_region_newline_preserved(
        self,
    ) -> None:
        source = (
            "class Alpha {}\n"
        )

        alpha = make_declaration(
            name="Alpha",
            start=0,
            end=len(source),
            removal_start=0,
            removal_end=len(source),
        )

        plan = DeclarationAddPlanner().plan(
            make_context(
                source=source,
                declarations=(alpha,),
                position="bottom",
            )
        )

        assert plan.edits[0].text.endswith(
            "\n"
        )

    def test_declarations_sorted_before_insert(
        self,
    ) -> None:
        source = (
            "class Alpha {}\n\n"
            "class Gamma {}\n"
        )

        alpha_start = source.index(
            "class Alpha"
        )
        alpha_end = source.index(
            "\n\n"
        )

        gamma_start = source.index(
            "class Gamma"
        )
        gamma_end = len(source)

        alpha = make_declaration(
            name="Alpha",
            start=alpha_start,
            end=alpha_end,
            removal_start=alpha_start,
            removal_end=alpha_end,
        )
        gamma = make_declaration(
            name="Gamma",
            start=gamma_start,
            end=gamma_end,
            removal_start=gamma_start,
            removal_end=gamma_end,
        )

        plan = DeclarationAddPlanner().plan(
            make_context(
                source=source,
                declarations=(gamma, alpha),
                before="Gamma",
            )
        )

        text = plan.edits[0].text

        assert text.index(
            "class Alpha"
        ) < text.index(
            "class Beta"
        ) < text.index(
            "class Gamma"
        )


class TestLeadingCommentBranches:
    def test_line_comment_attached(self) -> None:
        source = (
            "// Alpha documentation.\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == 0

    def test_blank_line_stops_comment_scan(
        self,
    ) -> None:
        source = (
            "// Detached.\n"
            "\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == declaration_start

    def test_block_comment_attached(self) -> None:
        source = (
            "/*\n"
            " * Alpha documentation.\n"
            " */\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
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

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == declaration_start

    def test_inline_block_comment_not_attached(
        self,
    ) -> None:
        source = (
            "const marker = true; /* docs */\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == declaration_start

    def test_non_comment_line_stops_scan(
        self,
    ) -> None:
        source = (
            "const marker = true;\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == declaration_start

    def test_crlf_comment_branch(self) -> None:
        source = (
            "// Documentation.\r\n"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == 0

    def test_carriage_return_only_branch(
        self,
    ) -> None:
        source = (
            "// Documentation.\r"
            "class Alpha {}"
        )

        declaration_start = source.index(
            "class Alpha"
        )

        result = (
            DeclarationAddPlanner()
            ._leading_comment_start(
                source,
                declaration_start,
            )
        )

        assert result == 0


def test_original_region_without_trailing_newline() -> None:
    source = "class Alpha {}"

    alpha = make_declaration(
        name="Alpha",
        start=0,
        end=len(source),
        removal_start=0,
        removal_end=len(source),
    )

    plan = DeclarationAddPlanner().plan(
        make_context(
            source=source,
            declarations=(alpha,),
            position="bottom",
        )
    )

    assert plan.edits[0].text == (
        "class Alpha {}\n\n"
        "class Beta {}"
    )

    assert not plan.edits[0].text.endswith(
        "\n"
    )
