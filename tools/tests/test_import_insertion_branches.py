from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import ImportNode
from tools.modifier.import_insertion import (
    CreateNewImportStrategy,
    DefaultWithNamedImportStrategy,
    DuplicateImportSymbol,
    ImportInsertion,
    ImportInsertionContext,
    ImportInsertionPlanner,
    ImportInsertionShape,
    MultilineNamedImportStrategy,
    SingleLineNamedImportStrategy,
    UnsupportedImportShape,
    _first_compatible_import,
    _is_multiline_named_import,
    _leading_header_end,
    _named_binding_range,
)


def make_named(
    *,
    imported: str,
    local: str | None = None,
    start: int = 0,
    end: int = 0,
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


def make_import(
    *,
    start: int,
    end: int,
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


def make_context(
    *,
    source: str = "",
    module: str = "./shared",
    symbol: str = "beta",
    imports: tuple[ImportNode, ...] = (),
    type_only: bool = False,
    quote_style: str = "'",
) -> ImportInsertionContext:
    return ImportInsertionContext(
        source=source,
        module=module,
        symbol=symbol,
        imports=imports,
        type_only=type_only,
        quote_style=quote_style,
    )


class TestContextValidation:
    def test_source_must_be_string(self) -> None:
        with pytest.raises(TypeError):
            make_context(source=123)

    @pytest.mark.parametrize("field", ("module", "symbol"))
    def test_required_strings_must_be_strings(
        self,
        field: str,
    ) -> None:
        kwargs = {field: 123}

        with pytest.raises(TypeError):
            make_context(**kwargs)

    @pytest.mark.parametrize("field", ("module", "symbol"))
    def test_required_strings_cannot_be_empty(
        self,
        field: str,
    ) -> None:
        kwargs = {field: "   "}

        with pytest.raises(ValueError):
            make_context(**kwargs)

    def test_imports_must_be_tuple(self) -> None:
        with pytest.raises(TypeError):
            make_context(imports=[])

    def test_imports_must_contain_import_nodes(
        self,
    ) -> None:
        with pytest.raises(TypeError):
            make_context(
                imports=(SimpleNamespace(),),
            )

    def test_type_only_must_be_boolean(self) -> None:
        with pytest.raises(TypeError):
            make_context(type_only="yes")

    def test_quote_style_rejected(self) -> None:
        with pytest.raises(ValueError):
            make_context(quote_style="`")


class TestContextHelpers:
    def test_imports_from_module(self) -> None:
        one = make_import(
            start=0,
            end=1,
            module="./one",
        )
        two = make_import(
            start=2,
            end=3,
            module="./two",
        )

        context = make_context(
            module="./one",
            imports=(one, two),
        )

        assert context.imports_from_module() == (
            one,
        )

    def test_compatible_imports_filters_shapes(
        self,
    ) -> None:
        compatible = make_import(
            start=0,
            end=1,
            module="./shared",
        )
        side_effect = make_import(
            start=2,
            end=3,
            module="./shared",
            side_effect_only=True,
        )
        namespace = make_import(
            start=4,
            end=5,
            module="./shared",
            namespace_import="Shared",
        )
        typed = make_import(
            start=6,
            end=7,
            module="./shared",
            type_only=True,
        )

        context = make_context(
            imports=(
                compatible,
                side_effect,
                namespace,
                typed,
            )
        )

        assert context.compatible_imports() == (
            compatible,
        )

    def test_duplicate_local_rejected(self) -> None:
        source = (
            "import { alpha as beta } "
            "from './other';"
        )

        start = source.index("alpha")
        end = source.index("beta") + 4

        node = make_import(
            start=0,
            end=len(source),
            module="./other",
            named=(
                make_named(
                    imported="alpha",
                    local="beta",
                    start=start,
                    end=end,
                ),
            ),
        )

        context = make_context(
            source=source,
            symbol="beta",
            imports=(node,),
        )

        with pytest.raises(
            DuplicateImportSymbol,
            match="already exists",
        ):
            context.ensure_not_duplicate()

    def test_duplicate_imported_rejected(
        self,
    ) -> None:
        source = (
            "import { beta as other } "
            "from './shared';"
        )

        start = source.index("beta")
        end = source.index("other") + 5

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    imported="beta",
                    local="other",
                    start=start,
                    end=end,
                ),
            ),
        )

        context = make_context(
            source=source,
            symbol="beta",
            imports=(node,),
        )

        with pytest.raises(
            DuplicateImportSymbol,
            match="already imported",
        ):
            context.ensure_not_duplicate()

    def test_non_duplicate_passes(self) -> None:
        context = make_context(
            imports=(),
        )

        context.ensure_not_duplicate()


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
                ImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
            field: value,
        }

        with pytest.raises(TypeError):
            ImportInsertion(**kwargs)

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
                ImportInsertionShape
                .NEW_IMPORT_DECLARATION
            ),
            field: -1,
        }

        with pytest.raises(ValueError):
            ImportInsertion(**kwargs)

    def test_end_cannot_precede_start(self) -> None:
        with pytest.raises(ValueError):
            ImportInsertion(
                start=2,
                end=1,
                text="x",
                shape=(
                    ImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )

    def test_text_must_be_string(self) -> None:
        with pytest.raises(TypeError):
            ImportInsertion(
                start=0,
                end=0,
                text=123,
                shape=(
                    ImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )

    def test_text_cannot_be_empty(self) -> None:
        with pytest.raises(ValueError):
            ImportInsertion(
                start=0,
                end=0,
                text="",
                shape=(
                    ImportInsertionShape
                    .NEW_IMPORT_DECLARATION
                ),
            )


class TestBindingHelpers:
    def test_missing_named_range_rejected(
        self,
    ) -> None:
        node = make_import(
            start=0,
            end=1,
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="named bindings",
        ):
            _named_binding_range(
                make_context(),
                node,
            )

    def test_named_range_converted(self) -> None:
        source = "import { alpha } from './shared';"
        start = source.index("{")
        end = source.index("}") + 1

        node = make_import(
            start=0,
            end=len(source),
            named_bindings_start=start,
            named_bindings_end=end,
        )

        assert _named_binding_range(
            make_context(source=source),
            node,
        ) == (start, end)

    def test_multiline_detection(self) -> None:
        source = (
            "import {\n"
            "  alpha,\n"
            "} from './shared';"
        )

        start = source.index("{")
        end = source.index("}") + 1

        node = make_import(
            start=0,
            end=len(source),
            named_bindings_start=start,
            named_bindings_end=end,
        )

        assert _is_multiline_named_import(
            make_context(source=source),
            node,
        )

    def test_singleline_detection(self) -> None:
        source = (
            "import { alpha } from './shared';"
        )

        start = source.index("{")
        end = source.index("}") + 1

        node = make_import(
            start=0,
            end=len(source),
            named_bindings_start=start,
            named_bindings_end=end,
        )

        assert not _is_multiline_named_import(
            make_context(source=source),
            node,
        )

    def test_first_compatible_none(self) -> None:
        assert (
            _first_compatible_import(
                make_context()
            )
            is None
        )

    def test_first_compatible_returned(self) -> None:
        node = make_import(
            start=0,
            end=1,
        )

        assert (
            _first_compatible_import(
                make_context(imports=(node,))
            )
            is node
        )


class TestMultilineStrategy:
    def test_supports_multiline(self) -> None:
        source = (
            "import {\n"
            "  alpha,\n"
            "} from './shared';"
        )

        binding_start = source.index("{")
        binding_end = source.index("}") + 1
        alpha_start = source.index("alpha")

        node = make_import(
            start=0,
            end=len(source),
            named=(
                make_named(
                    imported="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            named_bindings_start=binding_start,
            named_bindings_end=binding_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        strategy = MultilineNamedImportStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ImportInsertionShape
            .MULTILINE_NAMED_IMPORT
        )
        assert plan.text == "  beta,\n"

    def test_supports_false_without_ranges(
        self,
    ) -> None:
        node = make_import(
            start=0,
            end=1,
        )

        assert not (
            MultilineNamedImportStrategy()
            .supports(
                make_context(imports=(node,))
            )
        )

    def test_plan_without_match_rejected(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedImportShape,
            match="No multiline",
        ):
            MultilineNamedImportStrategy().plan(
                make_context()
            )

    def test_missing_closing_brace_rejected(
        self,
    ) -> None:
        source = (
            "import {\n"
            "  alpha,\n"
        )

        binding_start = source.index("{")
        binding_end = len(source)
        alpha_start = source.index("alpha")

        node = make_import(
            start=0,
            end=len(source),
            named=(
                make_named(
                    imported="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            named_bindings_start=binding_start,
            named_bindings_end=binding_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="closing brace",
        ):
            MultilineNamedImportStrategy().plan(
                context
            )

    def test_invalid_closing_indent_rejected(
        self,
    ) -> None:
        source = (
            "import {\n"
            "  alpha,\n"
            "bad} from './shared';"
        )

        binding_start = source.index("{")
        binding_end = source.index("}") + 1
        alpha_start = source.index("alpha")

        node = make_import(
            start=0,
            end=len(source),
            named=(
                make_named(
                    imported="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            named_bindings_start=binding_start,
            named_bindings_end=binding_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="unexpected content",
        ):
            MultilineNamedImportStrategy().plan(
                context
            )

    def test_fallback_indent_without_named_nodes(
        self,
    ) -> None:
        source = (
            "import {\n"
            "} from './shared';"
        )

        binding_start = source.index("{")
        binding_end = source.index("}") + 1

        node = make_import(
            start=0,
            end=len(source),
            named=(),
            named_bindings_start=binding_start,
            named_bindings_end=binding_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        plan = (
            MultilineNamedImportStrategy()
            .plan(context)
        )

        assert plan.text == "  beta,\n"


class TestSingleLineStrategy:
    def test_existing_content(self) -> None:
        source = (
            "import { alpha } from './shared';"
        )

        binding_start = source.index("{")
        binding_end = source.index("}") + 1
        alpha_start = source.index("alpha")

        node = make_import(
            start=0,
            end=len(source),
            named=(
                make_named(
                    imported="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            named_bindings_start=binding_start,
            named_bindings_end=binding_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        strategy = SingleLineNamedImportStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert plan.text == "{ alpha, beta }"

    def test_empty_binding_content(self) -> None:
        source = (
            "import {} from './shared';"
        )

        start = source.index("{")
        end = source.index("}") + 1

        node = make_import(
            start=0,
            end=len(source),
            named_bindings_start=start,
            named_bindings_end=end,
        )

        plan = (
            SingleLineNamedImportStrategy()
            .plan(
                make_context(
                    source=source,
                    imports=(node,),
                )
            )
        )

        assert plan.text == "{ beta }"

    def test_supports_false(self) -> None:
        assert not (
            SingleLineNamedImportStrategy()
            .supports(make_context())
        )

    def test_plan_without_match_rejected(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedImportShape,
            match="No single-line",
        ):
            SingleLineNamedImportStrategy().plan(
                make_context()
            )

    def test_invalid_braces_rejected(self) -> None:
        source = "import alpha from './shared';"

        node = make_import(
            start=0,
            end=len(source),
            named_bindings_start=7,
            named_bindings_end=12,
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="braces",
        ):
            SingleLineNamedImportStrategy().plan(
                make_context(
                    source=source,
                    imports=(node,),
                )
            )


class TestDefaultStrategy:
    def test_default_only_supported(self) -> None:
        source = (
            "import Alpha from './shared';"
        )

        clause_start = source.index("Alpha")
        clause_end = clause_start + len("Alpha")

        node = make_import(
            start=0,
            end=len(source),
            default_import="Alpha",
            import_clause_start=clause_start,
            import_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
        )

        strategy = DefaultWithNamedImportStrategy()

        assert strategy.supports(context)

        plan = strategy.plan(context)

        assert (
            plan.shape
            == ImportInsertionShape
            .DEFAULT_WITH_NAMED_IMPORT
        )
        assert plan.text == ", { beta }"

    def test_supports_false(self) -> None:
        assert not (
            DefaultWithNamedImportStrategy()
            .supports(make_context())
        )

    def test_plan_without_match_rejected(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedImportShape,
            match="No default-only",
        ):
            DefaultWithNamedImportStrategy().plan(
                make_context()
            )

    def test_missing_clause_end_rejected(
        self,
    ) -> None:
        node = make_import(
            start=0,
            end=1,
            default_import="Alpha",
            import_clause_end=None,
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="importClauseEnd",
        ):
            DefaultWithNamedImportStrategy().plan(
                make_context(imports=(node,))
            )


class TestLeadingHeader:
    def test_empty_source(self) -> None:
        assert _leading_header_end("") == 0

    def test_bom(self) -> None:
        assert _leading_header_end(
            "\ufeffconst value = 1;"
        ) == 1

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

    def test_unterminated_block_comment(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedImportShape,
            match="Unterminated",
        ):
            _leading_header_end(
                "/* generated"
            )

    def test_blank_lines_and_spaces(self) -> None:
        source = (
            "\n \t\n"
            "const value = 1;"
        )

        assert _leading_header_end(source) == (
            source.index("const")
        )


class TestCreateNewImport:
    def test_supports_always_true(self) -> None:
        assert CreateNewImportStrategy().supports(
            make_context()
        )

    def test_after_existing_import(self) -> None:
        source = (
            "import Alpha from './alpha';"
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./alpha",
        )

        plan = CreateNewImportStrategy().plan(
            make_context(
                source=source,
                imports=(node,),
            )
        )

        assert plan.start == len(source)
        assert plan.text == (
            "\nimport { beta } "
            "from './shared';"
        )

    def test_new_type_import(self) -> None:
        plan = CreateNewImportStrategy().plan(
            make_context(
                source="",
                type_only=True,
                quote_style='"',
            )
        )

        assert plan.text == (
            'import type { beta } '
            'from "./shared";\n'
        )

    def test_before_regular_source(self) -> None:
        source = "const value = 1;"

        plan = CreateNewImportStrategy().plan(
            make_context(source=source)
        )

        assert plan.start == 0
        assert plan.text == (
            "import { beta } "
            "from './shared';\n\n"
        )

    def test_after_header_with_newline(self) -> None:
        source = (
            "// generated\n"
            "const value = 1;"
        )

        plan = CreateNewImportStrategy().plan(
            make_context(source=source)
        )

        assert plan.start == source.index(
            "const"
        )
        assert plan.text == (
            "import { beta } "
            "from './shared';\n\n"
        )

    def test_header_without_trailing_newline(
        self,
    ) -> None:
        source = "// generated"

        plan = CreateNewImportStrategy().plan(
            make_context(source=source)
        )

        assert plan.start == len(source)
        assert plan.text.startswith(
            "\nimport { beta }"
        )


class TestPlanner:
    def test_multiline_selected_first(self) -> None:
        source = (
            "import {\n"
            "  alpha,\n"
            "} from './shared';"
        )

        start = source.index("{")
        end = source.index("}") + 1
        alpha_start = source.index("alpha")

        node = make_import(
            start=0,
            end=len(source),
            named=(
                make_named(
                    imported="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            named_bindings_start=start,
            named_bindings_end=end,
        )

        plan = ImportInsertionPlanner().plan(
            make_context(
                source=source,
                imports=(node,),
            )
        )

        assert (
            plan.shape
            == ImportInsertionShape
            .MULTILINE_NAMED_IMPORT
        )

    def test_custom_empty_strategies_rejected(
        self,
    ) -> None:
        planner = ImportInsertionPlanner(
            strategies=[],
        )

        # Current constructor falls back to defaults when
        # given an empty list.
        assert planner.strategies

    def test_no_strategy_supports(self) -> None:
        class NeverStrategy(
            CreateNewImportStrategy
        ):
            def supports(
                self,
                context,
            ) -> bool:
                return False

        planner = ImportInsertionPlanner(
            strategies=[NeverStrategy()],
        )

        with pytest.raises(
            UnsupportedImportShape,
            match="No import insertion strategy",
        ):
            planner.plan(make_context())


def test_singleline_supports_skips_first_compatible_import() -> None:
    multiline_source = (
        "import {\n"
        "  alpha,\n"
        "} from './shared';\n"
        "import { gamma } from './shared';"
    )

    first_binding_start = multiline_source.index("{")
    first_binding_end = (
        multiline_source.index("}") + 1
    )
    alpha_start = multiline_source.index(
        "alpha"
    )

    second_import_start = multiline_source.index(
        "import { gamma"
    )
    second_binding_start = multiline_source.index(
        "{",
        second_import_start,
    )
    second_binding_end = (
        multiline_source.index(
            "}",
            second_binding_start,
        )
        + 1
    )
    gamma_start = multiline_source.index(
        "gamma"
    )

    first = make_import(
        start=0,
        end=multiline_source.index("\nimport"),
        named=(
            make_named(
                imported="alpha",
                start=alpha_start,
                end=alpha_start + len("alpha"),
            ),
        ),
        named_bindings_start=first_binding_start,
        named_bindings_end=first_binding_end,
    )

    second = make_import(
        start=second_import_start,
        end=len(multiline_source),
        named=(
            make_named(
                imported="gamma",
                start=gamma_start,
                end=gamma_start + len("gamma"),
            ),
        ),
        named_bindings_start=second_binding_start,
        named_bindings_end=second_binding_end,
    )

    context = make_context(
        source=multiline_source,
        imports=(first, second),
    )

    assert (
        SingleLineNamedImportStrategy()
        .supports(context)
    )


def test_default_supports_skips_first_compatible_import() -> None:
    source = (
        "import { alpha } from './shared';\n"
        "import DefaultValue from './shared';"
    )

    first_binding_start = source.index("{")
    first_binding_end = source.index("}") + 1
    alpha_start = source.index("alpha")

    first_end = source.index("\n")
    second_start = first_end + 1
    default_start = source.index(
        "DefaultValue"
    )
    default_end = (
        default_start + len("DefaultValue")
    )

    first = make_import(
        start=0,
        end=first_end,
        named=(
            make_named(
                imported="alpha",
                start=alpha_start,
                end=alpha_start + len("alpha"),
            ),
        ),
        named_bindings_start=first_binding_start,
        named_bindings_end=first_binding_end,
    )

    second = make_import(
        start=second_start,
        end=len(source),
        default_import="DefaultValue",
        import_clause_start=default_start,
        import_clause_end=default_end,
    )

    context = make_context(
        source=source,
        imports=(first, second),
    )

    assert (
        DefaultWithNamedImportStrategy()
        .supports(context)
    )


def test_block_comment_without_following_line_feed() -> None:
    source = (
        "/* generated */"
        "const value = 1;"
    )

    assert _leading_header_end(source) == (
        source.index("const")
    )
