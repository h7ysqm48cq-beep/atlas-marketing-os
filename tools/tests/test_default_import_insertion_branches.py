from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import ImportNode
from tools.modifier.default_import_insertion import (
    DefaultImportConflict,
    DefaultImportInsertion,
    DefaultImportInsertionContext,
    DefaultImportInsertionError,
    DefaultImportInsertionPlanner,
    DefaultImportInsertionShape,
    DuplicateDefaultImport,
    _leading_header_end,
    _matching_imports,
    _new_import_position,
    _validate_existing_default,
)


def make_import(
    *,
    start: int = 0,
    end: int = 1,
    module: str = "./shared",
    default_import: str | None = None,
    namespace_import: str | None = None,
    named: tuple[dict[str, object], ...] = (),
    type_only: bool = False,
    side_effect_only: bool = False,
    import_clause_start: int | None = None,
    import_clause_end: int | None = None,
    named_bindings_start: int | None = None,
    named_bindings_end: int | None = None,
) -> ImportNode:
    return ImportNode(
        raw={
            "module": module,
            "quoteStyle": "'",
            "sideEffectOnly": side_effect_only,
            "defaultImport": default_import,
            "namespaceImport": namespace_import,
            "namedImports": list(named),
            "typeOnly": type_only,
            "importClauseStart": import_clause_start,
            "importClauseEnd": import_clause_end,
            "namedBindingsStart": named_bindings_start,
            "namedBindingsEnd": named_bindings_end,
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


def make_named(
    *,
    imported: str,
    local: str | None = None,
    start: int = 0,
    end: int = 1,
) -> dict[str, object]:
    return {
        "imported": imported,
        "local": imported if local is None else local,
        "typeOnly": False,
        "start": start,
        "end": end,
        "startLine": 1,
        "startColumn": 1,
        "endLine": 1,
        "endColumn": 1,
    }


def make_context(
    *,
    source: str = "",
    module: str = "./shared",
    symbol: str = "Shared",
    imports: tuple[ImportNode, ...] = (),
    type_only: bool = False,
    quote_style: str = "'",
) -> DefaultImportInsertionContext:
    return DefaultImportInsertionContext(
        source=source,
        module=module,
        symbol=symbol,
        imports=imports,
        type_only=type_only,
        quote_style=quote_style,
    )


class TestContextValidation:
    def test_source_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            make_context(source=123)

    @pytest.mark.parametrize(
        "field",
        ("module", "symbol"),
    )
    def test_strings_must_be_strings(
        self,
        field: str,
    ) -> None:
        with pytest.raises(
            TypeError,
            match=f"{field} must be a string",
        ):
            make_context(**{field: 123})

    @pytest.mark.parametrize(
        "field",
        ("module", "symbol"),
    )
    def test_strings_cannot_be_empty(
        self,
        field: str,
    ) -> None:
        with pytest.raises(
            ValueError,
            match=f"{field} cannot be empty",
        ):
            make_context(**{field: "   "})

    def test_imports_must_be_tuple(self) -> None:
        with pytest.raises(
            TypeError,
            match="imports must be a tuple",
        ):
            make_context(imports=[])

    def test_import_items_must_be_nodes(self) -> None:
        with pytest.raises(
            TypeError,
            match="ImportNode objects",
        ):
            make_context(
                imports=(SimpleNamespace(),),
            )

    def test_type_only_must_be_boolean(self) -> None:
        with pytest.raises(
            TypeError,
            match="type_only must be a boolean",
        ):
            make_context(type_only="yes")

    def test_quote_style_rejected(self) -> None:
        with pytest.raises(
            ValueError,
            match="quote_style",
        ):
            make_context(quote_style="`")


class TestInsertionValidation:
    @pytest.mark.parametrize(
        "field",
        ("start", "end"),
    )
    @pytest.mark.parametrize(
        "value",
        (True, "1", 1.5),
    )
    def test_positions_must_be_integers(
        self,
        field: str,
        value: object,
    ) -> None:
        kwargs = {
            "start": 0,
            "end": 0,
            "text": "x",
            "shape": (
                DefaultImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
            field: value,
        }

        with pytest.raises(
            TypeError,
            match=f"{field} must be an integer",
        ):
            DefaultImportInsertion(**kwargs)

    @pytest.mark.parametrize(
        "field",
        ("start", "end"),
    )
    def test_positions_cannot_be_negative(
        self,
        field: str,
    ) -> None:
        kwargs = {
            "start": 0,
            "end": 0,
            "text": "x",
            "shape": (
                DefaultImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
            field: -1,
        }

        with pytest.raises(
            ValueError,
            match="cannot be negative",
        ):
            DefaultImportInsertion(**kwargs)

    def test_end_cannot_precede_start(self) -> None:
        with pytest.raises(
            ValueError,
            match="before start",
        ):
            DefaultImportInsertion(
                start=2,
                end=1,
                text="x",
                shape=(
                    DefaultImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )

    def test_text_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            DefaultImportInsertion(
                start=0,
                end=0,
                text=123,
                shape=(
                    DefaultImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )

    def test_text_cannot_be_empty(self) -> None:
        with pytest.raises(
            ValueError,
            match="text cannot be empty",
        ):
            DefaultImportInsertion(
                start=0,
                end=0,
                text="",
                shape=(
                    DefaultImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )


class TestMatchingImports:
    def test_filters_incompatible_imports(self) -> None:
        matching = make_import(
            module="./shared",
        )
        wrong_module = make_import(
            module="./other",
        )
        side_effect = make_import(
            module="./shared",
            side_effect_only=True,
        )
        wrong_type = make_import(
            module="./shared",
            type_only=True,
        )

        context = make_context(
            imports=(
                matching,
                wrong_module,
                side_effect,
                wrong_type,
            )
        )

        assert _matching_imports(context) == (
            matching,
        )


class TestConflictValidation:
    def test_duplicate_default_same_module(
        self,
    ) -> None:
        node = make_import(
            module="./shared",
            default_import="Shared",
        )

        with pytest.raises(
            DuplicateDefaultImport,
            match="already exists",
        ):
            _validate_existing_default(
                make_context(imports=(node,))
            )

    def test_same_local_name_other_module(
        self,
    ) -> None:
        node = make_import(
            module="./other",
            default_import="Shared",
        )

        with pytest.raises(
            DefaultImportConflict,
            match="already used",
        ):
            _validate_existing_default(
                make_context(imports=(node,))
            )

    def test_local_named_import_conflict(
        self,
    ) -> None:
        node = make_import(
            module="./other",
            named=(
                make_named(
                    imported="Other",
                    local="Shared",
                ),
            ),
        )

        with pytest.raises(
            DefaultImportConflict,
            match="already exists",
        ):
            _validate_existing_default(
                make_context(imports=(node,))
            )

    def test_module_has_different_default(
        self,
    ) -> None:
        node = make_import(
            module="./shared",
            default_import="Existing",
        )

        with pytest.raises(
            DefaultImportConflict,
            match="already has",
        ):
            _validate_existing_default(
                make_context(imports=(node,))
            )

    def test_no_conflict(self) -> None:
        _validate_existing_default(
            make_context()
        )


class TestLeadingHeader:
    def test_empty_source(self) -> None:
        assert _leading_header_end("") == 0

    def test_bom(self) -> None:
        source = "\ufeffconst value = 1;"

        assert _leading_header_end(source) == 1

    def test_shebang(self) -> None:
        source = (
            "#!/usr/bin/env node\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_shebang_without_newline(self) -> None:
        source = "#!/usr/bin/env node"

        assert _leading_header_end(source) == len(
            source
        )

    def test_blank_lines(self) -> None:
        source = (
            "\n \t\r\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_line_comment(self) -> None:
        source = (
            "// generated\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_line_comment_without_newline(
        self,
    ) -> None:
        source = "// generated"

        assert _leading_header_end(source) == len(
            source
        )

    def test_block_comment(self) -> None:
        source = (
            "/* generated */\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_block_comment_crlf(self) -> None:
        source = (
            "/* generated */\r\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_block_comment_without_newline(
        self,
    ) -> None:
        source = (
            "/* generated */"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )

    def test_unterminated_block_comment(
        self,
    ) -> None:
        with pytest.raises(
            DefaultImportInsertionError,
            match="Unterminated",
        ):
            _leading_header_end(
                "/* generated"
            )


class TestNewImportPosition:
    def test_after_existing_import_and_gap(
        self,
    ) -> None:
        source = (
            "import Existing from './existing';"
            "\n\n  \n"
            "const value = 1;"
        )

        import_end = source.index("\n")

        node = make_import(
            start=0,
            end=import_end,
            module="./existing",
        )

        start, end, leading, trailing = (
            _new_import_position(
                make_context(
                    source=source,
                    imports=(node,),
                )
            )
        )

        assert start == import_end
        assert end > start
        assert leading == "\n\n"
        assert trailing == "\n\n"

    def test_empty_source(self) -> None:
        result = _new_import_position(
            make_context(source="")
        )

        assert result == (
            0,
            0,
            "",
            "\n",
        )

    def test_regular_source(self) -> None:
        source = "const value = 1;"

        start, end, leading, trailing = (
            _new_import_position(
                make_context(source=source)
            )
        )

        assert start == 0
        assert end == 0
        assert leading == ""
        assert trailing == "\n\n"

    def test_header_without_trailing_newline(
        self,
    ) -> None:
        source = "// generated"

        start, end, leading, trailing = (
            _new_import_position(
                make_context(source=source)
            )
        )

        assert start == len(source)
        assert end == len(source)
        assert leading == "\n"
        assert trailing == "\n"

    def test_header_with_trailing_newline(
        self,
    ) -> None:
        source = (
            "// generated\n"
            "const value = 1;"
        )

        start, end, leading, trailing = (
            _new_import_position(
                make_context(source=source)
            )
        )

        assert start == source.index("const")
        assert end == start
        assert leading == ""
        assert trailing == "\n\n"


class TestPlanner:
    def test_insert_into_existing_clause(
        self,
    ) -> None:
        source = (
            "import { alpha } from './shared';"
        )

        clause_start = source.index("{")

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            import_clause_start=clause_start,
            import_clause_end=(
                source.index("}") + 1
            ),
            named_bindings_start=clause_start,
            named_bindings_end=(
                source.index("}") + 1
            ),
        )

        plan = DefaultImportInsertionPlanner().plan(
            make_context(
                source=source,
                imports=(node,),
            )
        )

        assert (
            plan.shape
            == DefaultImportInsertionShape
            .EXISTING_IMPORT_CLAUSE
        )
        assert plan.start == clause_start
        assert plan.end == clause_start
        assert plan.text == "Shared, "

    def test_skips_import_without_clause_start(
        self,
    ) -> None:
        source = (
            "import './shared';\n"
            "const value = 1;\n"
        )

        import_end = source.index("\n")

        missing_clause = make_import(
            start=0,
            end=import_end,
            module="./shared",
            side_effect_only=False,
            import_clause_start=None,
        )

        plan = DefaultImportInsertionPlanner().plan(
            make_context(
                source=source,
                imports=(missing_clause,),
            )
        )

        assert (
            plan.shape
            == DefaultImportInsertionShape
            .NEW_IMPORT_DECLARATION
        )

    def test_skips_existing_default_import(
        self,
    ) -> None:
        existing = make_import(
            module="./shared",
            default_import="Existing",
            import_clause_start=7,
        )

        with pytest.raises(
            DefaultImportConflict,
        ):
            DefaultImportInsertionPlanner().plan(
                make_context(
                    imports=(existing,),
                )
            )

    def test_new_default_import(self) -> None:
        plan = DefaultImportInsertionPlanner().plan(
            make_context(
                source="const value = 1;",
            )
        )

        assert (
            plan.shape
            == DefaultImportInsertionShape
            .NEW_IMPORT_DECLARATION
        )
        assert plan.text == (
            "import Shared "
            "from './shared';\n\n"
        )

    def test_new_type_default_import(self) -> None:
        plan = DefaultImportInsertionPlanner().plan(
            make_context(
                source="",
                type_only=True,
                quote_style='"',
            )
        )

        assert plan.text == (
            'import type Shared '
            'from "./shared";\n'
        )


def test_planner_skips_existing_default_branch(
    monkeypatch,
) -> None:
    import tools.modifier.default_import_insertion as module

    source = (
        "import Existing from './shared';\n"
        "const value = 1;\n"
    )

    import_end = source.index("\n")
    clause_start = source.index("Existing")
    clause_end = clause_start + len("Existing")

    existing = make_import(
        start=0,
        end=import_end,
        module="./shared",
        default_import="Existing",
        import_clause_start=clause_start,
        import_clause_end=clause_end,
    )

    monkeypatch.setattr(
        module,
        "_validate_existing_default",
        lambda context: None,
    )

    plan = module.DefaultImportInsertionPlanner().plan(
        make_context(
            source=source,
            imports=(existing,),
        )
    )

    assert (
        plan.shape
        == module.DefaultImportInsertionShape
        .NEW_IMPORT_DECLARATION
    )
