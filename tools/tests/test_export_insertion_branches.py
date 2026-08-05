from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ExportNode,
    ImportNode,
)
from tools.modifier.export_insertion import (
    DuplicateExportSymbol,
    ExportInsertion,
    ExportInsertionContext,
    ExportInsertionPlanner,
    ExportInsertionShape,
    InvalidExportInsertion,
    _ends_with_blank_line,
    _ends_with_line_ending,
    _export_all_exists,
    _export_clause_end,
    _insertion_position,
    _insertion_text,
    _is_local_named_export,
    _line_ending,
    _local_export_insertion_text,
    _named_export_exists,
    _namespace_export_exists,
    _raw_field,
    _render_binding,
    _render_statement,
    _statement_end,
    _top_level_export_nodes,
)


def make_named(
    *,
    local: str,
    exported: str | None = None,
    type_only: bool = False,
    start: int = 0,
    end: int = 0,
) -> dict[str, object]:
    return {
        "local": local,
        "exported": (
            local
            if exported is None
            else exported
        ),
        "typeOnly": type_only,
        "start": start,
        "end": end,
        "startLine": 1,
        "startColumn": 1,
        "endLine": 1,
        "endColumn": 1,
    }


def make_export(
    *,
    start: int,
    end: int,
    module: str | None = None,
    named: tuple[dict[str, object], ...] = (),
    export_all: bool = False,
    namespace_export: str | None = None,
    type_only: bool = False,
    export_clause_end: object = None,
) -> ExportNode:
    raw: dict[str, object] = {
        "module": module,
        "quoteStyle": "'",
        "exportAll": export_all,
        "namespaceExport": namespace_export,
        "namedExports": list(named),
        "typeOnly": type_only,
        "start": start,
        "end": end,
        "startLine": 1,
        "startColumn": 1,
        "endLine": 1,
        "endColumn": 1,
    }

    if export_clause_end is not None:
        raw["exportClauseEnd"] = export_clause_end

    return ExportNode(raw=raw)


def make_import(
    *,
    start: int,
    end: int,
    module: str = "./dependency",
) -> ImportNode:
    return ImportNode(
        raw={
            "module": module,
            "quoteStyle": "'",
            "sideEffectOnly": False,
            "defaultImport": "Dependency",
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
    exports: tuple[ExportNode, ...] = (),
    imports: tuple[ImportNode, ...] = (),
    symbol: str | None = "alpha",
    module: str | None = None,
    exported_as: str | None = None,
    type_only: bool = False,
    export_all: bool = False,
    namespace_export: str | None = None,
    quote_style: str = "'",
) -> ExportInsertionContext:
    return ExportInsertionContext(
        source=source,
        exports=exports,
        imports=imports,
        symbol=symbol,
        module=module,
        exported_as=exported_as,
        type_only=type_only,
        export_all=export_all,
        namespace_export=namespace_export,
        quote_style=quote_style,
    )


class TestContextValidation:
    def test_source_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            make_context(source=123)

    def test_exports_must_be_tuple(self) -> None:
        with pytest.raises(
            TypeError,
            match="exports must be a tuple",
        ):
            make_context(exports=[])

    def test_exports_must_contain_export_nodes(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="ExportNode objects",
        ):
            make_context(
                exports=(SimpleNamespace(),),
            )

    def test_imports_must_be_tuple(self) -> None:
        with pytest.raises(
            TypeError,
            match="imports must be a tuple",
        ):
            make_context(imports=[])

    def test_imports_must_contain_import_nodes(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="ImportNode objects",
        ):
            make_context(
                imports=(SimpleNamespace(),),
            )

    @pytest.mark.parametrize(
        "field",
        (
            "symbol",
            "module",
            "exported_as",
            "namespace_export",
        ),
    )
    def test_optional_strings_must_be_strings(
        self,
        field: str,
    ) -> None:
        kwargs = {
            "symbol": "alpha",
            field: 123,
        }

        with pytest.raises(
            TypeError,
            match=f"{field} must be a string",
        ):
            make_context(**kwargs)

    @pytest.mark.parametrize(
        "field",
        (
            "symbol",
            "module",
            "exported_as",
            "namespace_export",
        ),
    )
    def test_optional_strings_cannot_be_empty(
        self,
        field: str,
    ) -> None:
        kwargs = {
            "symbol": "alpha",
            field: "   ",
        }

        with pytest.raises(
            ValueError,
            match=f"{field} cannot be empty",
        ):
            make_context(**kwargs)

    def test_type_only_must_be_boolean(self) -> None:
        with pytest.raises(
            TypeError,
            match="type_only must be a boolean",
        ):
            make_context(type_only="yes")

    def test_export_all_must_be_boolean(self) -> None:
        with pytest.raises(
            TypeError,
            match="export_all must be a boolean",
        ):
            make_context(export_all="yes")

    def test_quote_style_rejected(self) -> None:
        with pytest.raises(
            ValueError,
            match="quote_style",
        ):
            make_context(quote_style="`")


class TestShapeValidation:
    def test_export_all_and_namespace_conflict(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot be combined",
        ):
            make_context(
                symbol=None,
                module="./shared",
                export_all=True,
                namespace_export="shared",
            )

    def test_export_all_requires_module(self) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="requires a module",
        ):
            make_context(
                symbol=None,
                export_all=True,
            )

    def test_export_all_rejects_symbol(self) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot contain a symbol",
        ):
            make_context(
                symbol="alpha",
                module="./shared",
                export_all=True,
            )

    def test_export_all_rejects_exported_as(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot use exported_as",
        ):
            make_context(
                symbol=None,
                module="./shared",
                exported_as="beta",
                export_all=True,
            )

    def test_export_all_rejects_type_only(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot be type-only",
        ):
            make_context(
                symbol=None,
                module="./shared",
                type_only=True,
                export_all=True,
            )

    def test_namespace_requires_module(self) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="requires a module",
        ):
            make_context(
                symbol=None,
                namespace_export="shared",
            )

    def test_namespace_rejects_symbol(self) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot contain",
        ):
            make_context(
                symbol="alpha",
                module="./shared",
                namespace_export="shared",
            )

    def test_namespace_rejects_exported_as(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot use",
        ):
            make_context(
                symbol=None,
                module="./shared",
                namespace_export="shared",
                exported_as="other",
            )

    def test_namespace_rejects_type_only(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="cannot be type-only",
        ):
            make_context(
                symbol=None,
                module="./shared",
                namespace_export="shared",
                type_only=True,
            )

    def test_named_export_requires_symbol(
        self,
    ) -> None:
        with pytest.raises(
            InvalidExportInsertion,
            match="requires a symbol",
        ):
            make_context(symbol=None)


class TestNormalizedProperties:
    def test_normalized_values(self) -> None:
        context = make_context(
            symbol=" alpha ",
            module=" ./shared ",
            exported_as=" beta ",
        )

        assert context.normalized_symbol == "alpha"
        assert context.normalized_module == "./shared"
        assert context.normalized_exported_as == "beta"
        assert context.normalized_namespace is None

    def test_normalized_namespace(self) -> None:
        context = make_context(
            symbol=None,
            module="./shared",
            namespace_export=" shared ",
        )

        assert (
            context.normalized_namespace
            == "shared"
        )


class TestInsertionValidation:
    @pytest.mark.parametrize(
        "field",
        ("start", "end"),
    )
    @pytest.mark.parametrize(
        "value",
        (True, 1.5, "1"),
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
                ExportInsertionShape.NAMED_EXPORT
            ),
            field: value,
        }

        with pytest.raises(
            TypeError,
            match=f"{field} must be an integer",
        ):
            ExportInsertion(**kwargs)

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
                ExportInsertionShape.NAMED_EXPORT
            ),
            field: -1,
        }

        with pytest.raises(
            ValueError,
            match="cannot be negative",
        ):
            ExportInsertion(**kwargs)

    def test_end_cannot_precede_start(self) -> None:
        with pytest.raises(
            ValueError,
            match="before start",
        ):
            ExportInsertion(
                start=2,
                end=1,
                text="x",
                shape=(
                    ExportInsertionShape
                    .NAMED_EXPORT
                ),
            )

    def test_text_must_be_string(self) -> None:
        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            ExportInsertion(
                start=0,
                end=0,
                text=123,
                shape=(
                    ExportInsertionShape
                    .NAMED_EXPORT
                ),
            )

    def test_text_cannot_be_empty(self) -> None:
        with pytest.raises(
            ValueError,
            match="text cannot be empty",
        ):
            ExportInsertion(
                start=0,
                end=0,
                text="",
                shape=(
                    ExportInsertionShape
                    .NAMED_EXPORT
                ),
            )


class TestBasicHelpers:
    def test_line_endings(self) -> None:
        assert _line_ending("a\r\nb") == "\r\n"
        assert _line_ending("a\nb") == "\n"

    def test_statement_end_at_source_end(self) -> None:
        assert _statement_end("abc", 3) == 3

    def test_statement_end_consumes_crlf(
        self,
    ) -> None:
        assert _statement_end("abc\r\nx", 3) == 5

    def test_statement_end_consumes_lf(self) -> None:
        assert _statement_end("abc\nx", 3) == 4

    def test_statement_end_without_newline(
        self,
    ) -> None:
        assert _statement_end("abc x", 3) == 3

    def test_raw_field_dict(self) -> None:
        assert (
            _raw_field(
                {"value": 10},
                "value",
            )
            == 10
        )

    def test_raw_field_object(self) -> None:
        assert (
            _raw_field(
                SimpleNamespace(value=10),
                "value",
            )
            == 10
        )

    def test_export_clause_end_none(self) -> None:
        node = make_export(
            start=0,
            end=1,
        )

        assert _export_clause_end(node) is None

    @pytest.mark.parametrize(
        "value",
        (True, "10", 1.5),
    )
    def test_invalid_export_clause_end(
        self,
        value: object,
    ) -> None:
        node = make_export(
            start=0,
            end=1,
            export_clause_end=value,
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="must be an integer",
        ):
            _export_clause_end(node)

    def test_valid_export_clause_end(self) -> None:
        node = make_export(
            start=0,
            end=10,
            export_clause_end=8,
        )

        assert _export_clause_end(node) == 8


class TestExistenceHelpers:
    def test_named_export_exists(self) -> None:
        named = make_named(
            local="alpha",
            exported="beta",
        )

        node = make_export(
            start=0,
            end=20,
            module="./shared",
            named=(named,),
        )

        context = make_context(
            exports=(node,),
            symbol="alpha",
            exported_as="beta",
            module="./shared",
        )

        assert _named_export_exists(context)

    def test_named_export_different_module(
        self,
    ) -> None:
        node = make_export(
            start=0,
            end=20,
            module="./one",
            named=(
                make_named(local="alpha"),
            ),
        )

        context = make_context(
            exports=(node,),
            module="./two",
        )

        assert not _named_export_exists(context)

    def test_named_export_skips_star_namespace_and_type(
        self,
    ) -> None:
        star = make_export(
            start=0,
            end=1,
            module="./shared",
            export_all=True,
        )
        namespace = make_export(
            start=2,
            end=3,
            module="./shared",
            namespace_export="shared",
        )
        typed = make_export(
            start=4,
            end=5,
            module="./shared",
            type_only=True,
            named=(
                make_named(
                    local="alpha",
                    type_only=True,
                ),
            ),
        )

        context = make_context(
            exports=(star, namespace, typed),
            module="./shared",
            symbol="alpha",
            type_only=False,
        )

        assert not _named_export_exists(context)

    def test_export_all_exists(self) -> None:
        node = make_export(
            start=0,
            end=1,
            module="./shared",
            export_all=True,
        )

        context = make_context(
            exports=(node,),
            symbol=None,
            module="./shared",
            export_all=True,
        )

        assert _export_all_exists(context)

    def test_namespace_export_exists(self) -> None:
        node = make_export(
            start=0,
            end=1,
            module="./shared",
            namespace_export="shared",
        )

        context = make_context(
            exports=(node,),
            symbol=None,
            module="./shared",
            namespace_export="shared",
        )

        assert _namespace_export_exists(context)


class TestRendering:
    def test_render_binding_plain(self) -> None:
        assert (
            _render_binding(
                make_context(symbol="alpha")
            )
            == "alpha"
        )

    def test_render_binding_alias(self) -> None:
        assert (
            _render_binding(
                make_context(
                    symbol="alpha",
                    exported_as="beta",
                )
            )
            == "alpha as beta"
        )

    def test_render_export_all(self) -> None:
        context = make_context(
            symbol=None,
            module="./shared",
            export_all=True,
            quote_style='"',
        )

        statement, shape = _render_statement(
            context
        )

        assert (
            statement
            == 'export * from "./shared";'
        )
        assert shape == ExportInsertionShape.EXPORT_ALL

    def test_render_namespace(self) -> None:
        context = make_context(
            symbol=None,
            module="./shared",
            namespace_export="shared",
        )

        statement, shape = _render_statement(
            context
        )

        assert (
            statement
            == "export * as shared from './shared';"
        )
        assert (
            shape
            == ExportInsertionShape.NAMESPACE_EXPORT
        )

    def test_render_local_named(self) -> None:
        statement, shape = _render_statement(
            make_context(symbol="alpha")
        )

        assert statement == "export { alpha };"
        assert shape == ExportInsertionShape.NAMED_EXPORT

    def test_render_reexport_alias(self) -> None:
        statement, shape = _render_statement(
            make_context(
                symbol="alpha",
                exported_as="beta",
                module="./shared",
            )
        )

        assert (
            statement
            == (
                "export { alpha as beta } "
                "from './shared';"
            )
        )
        assert shape == ExportInsertionShape.RE_EXPORT

    def test_render_type_export(self) -> None:
        statement, shape = _render_statement(
            make_context(
                symbol="Alpha",
                module="./shared",
                type_only=True,
            )
        )

        assert (
            statement
            == (
                "export type { Alpha } "
                "from './shared';"
            )
        )
        assert shape == ExportInsertionShape.TYPE_EXPORT


class TestInsertionPositionAndSpacing:
    def test_local_export_position_is_end(
        self,
    ) -> None:
        context = make_context(
            source="const value = 1;",
        )

        assert (
            _insertion_position(context)
            == len(context.source)
        )

    def test_position_after_import(self) -> None:
        source = (
            "import Alpha from './alpha';\n"
            "\n"
            "const value = 1;\n"
        )

        import_end = source.index("\n")

        node = make_import(
            start=0,
            end=import_end,
        )

        context = make_context(
            source=source,
            imports=(node,),
            symbol="alpha",
            module="./shared",
        )

        assert (
            _insertion_position(context)
            == import_end + 1
        )

    def test_position_after_top_export(self) -> None:
        source = (
            "export * from './alpha';\n"
            "\n"
            "const value = 1;\n"
        )

        export_end = source.index("\n")

        node = make_export(
            start=0,
            end=export_end,
            module="./alpha",
            export_all=True,
        )

        context = make_context(
            source=source,
            exports=(node,),
            symbol="beta",
            module="./beta",
        )

        assert (
            _insertion_position(context)
            == export_end + 1
        )

    def test_position_zero_without_imports(
        self,
    ) -> None:
        context = make_context(
            source="const value = 1;\n",
            symbol="alpha",
            module="./shared",
        )

        assert _insertion_position(context) == 0

    def test_top_level_exports_excludes_local(
        self,
    ) -> None:
        local = make_export(
            start=0,
            end=10,
            module=None,
            named=(
                make_named(local="alpha"),
            ),
        )
        remote = make_export(
            start=11,
            end=20,
            module="./shared",
            named=(
                make_named(local="beta"),
            ),
        )

        context = make_context(
            exports=(local, remote),
        )

        assert (
            _top_level_export_nodes(context)
            == (remote,)
        )

    def test_local_detection(self) -> None:
        assert _is_local_named_export(
            make_context()
        )

        assert not _is_local_named_export(
            make_context(
                module="./shared",
            )
        )

    def test_ending_helpers(self) -> None:
        assert _ends_with_blank_line(
            "a\n\n",
            "\n",
        )
        assert not _ends_with_blank_line(
            "a\n",
            "\n",
        )
        assert _ends_with_line_ending("a\n")
        assert _ends_with_line_ending("a\r")
        assert not _ends_with_line_ending("a")

    def test_local_empty_source_text(self) -> None:
        context = make_context(source="")

        assert (
            _local_export_insertion_text(
                context,
                "export { alpha };",
            )
            == "export { alpha };\n"
        )

    def test_local_after_blank_line(self) -> None:
        context = make_context(
            source="const value = 1;\n\n",
        )

        assert (
            _local_export_insertion_text(
                context,
                "export { alpha };",
            )
            == "export { alpha };\n"
        )

    def test_local_after_single_newline(self) -> None:
        context = make_context(
            source="const value = 1;\n",
        )

        assert (
            _local_export_insertion_text(
                context,
                "export { alpha };",
            )
            == "\nexport { alpha };\n"
        )

    def test_local_after_no_newline(self) -> None:
        context = make_context(
            source="const value = 1;",
        )

        assert (
            _local_export_insertion_text(
                context,
                "export { alpha };",
            )
            == "\n\nexport { alpha };\n"
        )

    def test_nonlocal_empty_source_text(self) -> None:
        context = make_context(
            source="",
            module="./shared",
        )

        assert (
            _insertion_text(
                context,
                "export { alpha } from './shared';",
                0,
            )
            == (
                "export { alpha } "
                "from './shared';\n"
            )
        )

    def test_nonlocal_position_zero(self) -> None:
        context = make_context(
            source="const value = 1;\n",
            module="./shared",
        )

        assert (
            _insertion_text(
                context,
                "export { alpha } from './shared';",
                0,
            )
            == (
                "export { alpha } "
                "from './shared';\n\n"
            )
        )

    def test_nonlocal_at_end_with_newline(
        self,
    ) -> None:
        context = make_context(
            source="import x from 'x';\n",
            module="./shared",
        )

        statement = (
            "export { alpha } from './shared';"
        )

        assert (
            _insertion_text(
                context,
                statement,
                len(context.source),
            )
            == statement + "\n"
        )

    def test_nonlocal_at_end_without_newline(
        self,
    ) -> None:
        context = make_context(
            source="import x from 'x';",
            module="./shared",
        )

        statement = (
            "export { alpha } from './shared';"
        )

        assert (
            _insertion_text(
                context,
                statement,
                len(context.source),
            )
            == "\n" + statement + "\n"
        )

    def test_nonlocal_middle_position(self) -> None:
        context = make_context(
            source=(
                "import x from 'x';\n"
                "\n"
                "const value = 1;\n"
            ),
            module="./shared",
        )

        statement = (
            "export { alpha } from './shared';"
        )

        assert (
            _insertion_text(
                context,
                statement,
                19,
            )
            == statement + "\n"
        )


class TestPlanner:
    def test_wrong_context_type(self) -> None:
        with pytest.raises(
            TypeError,
            match="ExportInsertionContext",
        ):
            ExportInsertionPlanner().plan(
                "invalid"
            )

    def test_duplicate_export_all(self) -> None:
        node = make_export(
            start=0,
            end=10,
            module="./shared",
            export_all=True,
        )

        context = make_context(
            exports=(node,),
            symbol=None,
            module="./shared",
            export_all=True,
        )

        with pytest.raises(
            DuplicateExportSymbol,
            match="Export-all",
        ):
            ExportInsertionPlanner().plan(
                context
            )

    def test_duplicate_namespace(self) -> None:
        node = make_export(
            start=0,
            end=10,
            module="./shared",
            namespace_export="shared",
        )

        context = make_context(
            exports=(node,),
            symbol=None,
            module="./shared",
            namespace_export="shared",
        )

        with pytest.raises(
            DuplicateExportSymbol,
            match="Namespace export",
        ):
            ExportInsertionPlanner().plan(
                context
            )

    def test_duplicate_named_export(self) -> None:
        node = make_export(
            start=0,
            end=10,
            named=(
                make_named(local="alpha"),
            ),
        )

        context = make_context(
            exports=(node,),
            symbol="alpha",
        )

        with pytest.raises(
            DuplicateExportSymbol,
            match="already exists",
        ):
            ExportInsertionPlanner().plan(
                context
            )

    def test_plan_new_local_export(self) -> None:
        context = make_context(
            source="const value = 1;\n",
            symbol="alpha",
        )

        plan = ExportInsertionPlanner().plan(
            context
        )

        assert (
            plan.shape
            == ExportInsertionShape.NAMED_EXPORT
        )
        assert plan.start == len(context.source)
        assert plan.end == len(context.source)
        assert "export { alpha };" in plan.text

    def test_plan_export_all(self) -> None:
        context = make_context(
            source="",
            symbol=None,
            module="./shared",
            export_all=True,
        )

        plan = ExportInsertionPlanner().plan(
            context
        )

        assert (
            plan.shape
            == ExportInsertionShape.EXPORT_ALL
        )
        assert (
            plan.text
            == "export * from './shared';\n"
        )


class TestRemainingNormalizedBranches:
    def test_normalized_symbol_none(self) -> None:
        context = make_context(
            symbol=None,
            module="./shared",
            export_all=True,
        )

        assert context.normalized_symbol is None

    def test_named_exists_returns_false_without_symbol(
        self,
    ) -> None:
        context = make_context(
            symbol=None,
            module="./shared",
            export_all=True,
        )

        assert not _named_export_exists(context)


class TestCompatibleNamedExport:
    def test_special_shapes_are_not_compatible(
        self,
    ) -> None:
        export_all_context = make_context(
            symbol=None,
            module="./shared",
            export_all=True,
        )

        namespace_context = make_context(
            symbol=None,
            module="./shared",
            namespace_export="shared",
        )

        assert (
            __import__(
                "tools.modifier.export_insertion",
                fromlist=[
                    "_compatible_named_export"
                ],
            )
            ._compatible_named_export(
                export_all_context
            )
            is None
        )

        assert (
            __import__(
                "tools.modifier.export_insertion",
                fromlist=[
                    "_compatible_named_export"
                ],
            )
            ._compatible_named_export(
                namespace_context
            )
            is None
        )

    def test_skips_incompatible_nodes(
        self,
    ) -> None:
        source = (
            "export { alpha } from './correct';"
        )

        alpha_start = source.index("alpha")
        clause_end = source.index("}") + 1

        different_module = make_export(
            start=0,
            end=len(source),
            module="./wrong",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            export_clause_end=clause_end,
        )

        star = make_export(
            start=0,
            end=len(source),
            module="./correct",
            export_all=True,
        )

        namespace = make_export(
            start=0,
            end=len(source),
            module="./correct",
            namespace_export="shared",
        )

        wrong_type = make_export(
            start=0,
            end=len(source),
            module="./correct",
            type_only=True,
            named=(
                make_named(
                    local="Alpha",
                    type_only=True,
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            export_clause_end=clause_end,
        )

        empty_named = make_export(
            start=0,
            end=len(source),
            module="./correct",
            named=(),
            export_clause_end=clause_end,
        )

        missing_clause = make_export(
            start=0,
            end=len(source),
            module="./correct",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
        )

        context = make_context(
            source=source,
            exports=(
                different_module,
                star,
                namespace,
                wrong_type,
                empty_named,
                missing_clause,
            ),
            symbol="beta",
            module="./correct",
        )

        compatible = (
            __import__(
                "tools.modifier.export_insertion",
                fromlist=[
                    "_compatible_named_export"
                ],
            )
            ._compatible_named_export(context)
        )

        assert compatible is None

    def test_returns_first_compatible_node(
        self,
    ) -> None:
        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            exports=(node,),
            symbol="beta",
            module="./shared",
        )

        compatible = (
            __import__(
                "tools.modifier.export_insertion",
                fromlist=[
                    "_compatible_named_export"
                ],
            )
            ._compatible_named_export(context)
        )

        assert compatible is node


class TestMergeNamedExport:
    def test_merge_rejects_node_without_named_exports(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        node = make_export(
            start=0,
            end=10,
            module="./shared",
            named=(),
            export_clause_end=5,
        )

        context = make_context(
            source="export {};",
            symbol="alpha",
            module="./shared",
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="without named exports",
        ):
            module._merge_named_export(
                context,
                node,
            )

    def test_merge_requires_export_clause_range(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_start + 5,
                ),
            ),
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="export clause range",
        ):
            module._merge_named_export(
                context,
                node,
            )

    def test_single_line_merge(self) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            symbol="beta",
            exported_as="publicBeta",
            module="./shared",
        )

        insertion = module._merge_named_export(
            context,
            node,
        )

        assert (
            insertion.shape
            == ExportInsertionShape
            .SINGLE_LINE_NAMED_EXPORT
        )
        assert insertion.start == alpha_end
        assert insertion.end == alpha_end
        assert (
            insertion.text
            == ", beta as publicBeta"
        )

    def test_multiline_merge_without_trailing_comma(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export {\n"
            "  alpha\n"
            "} from './shared';\n"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source) - 1,
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        insertion = module._merge_named_export(
            context,
            node,
        )

        assert (
            insertion.shape
            == ExportInsertionShape
            .MULTILINE_NAMED_EXPORT
        )
        assert insertion.start == alpha_end
        assert insertion.end == clause_end
        assert insertion.text == (
            ",\n"
            "  beta\n"
            "}"
        )

    def test_multiline_merge_with_trailing_comma(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export {\r\n"
            "  alpha,\r\n"
            "} from './shared';\r\n"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end_python = source.index("}") + 1

        from tools.modifier.bridge_editor import (
            utf16_length,
        )

        clause_end = utf16_length(
            source[:clause_end_python]
        )

        node = make_export(
            start=0,
            end=utf16_length(
                source.rstrip("\r\n")
            ),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=utf16_length(
                        source[:alpha_start]
                    ),
                    end=utf16_length(
                        source[:alpha_end]
                    ),
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        insertion = module._merge_named_export(
            context,
            node,
        )

        assert insertion.text == (
            ",\r\n"
            "  beta,\r\n"
            "}"
        )

    def test_multiline_missing_closing_brace(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export {\n"
            "  alpha\n"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=len(source),
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="closing brace",
        ):
            module._merge_named_export(
                context,
                node,
            )

    def test_invalid_element_indentation(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export {\n"
            "prefix alpha\n"
            "} from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="element indentation",
        ):
            module._merge_named_export(
                context,
                node,
            )

    def test_invalid_closing_indentation(
        self,
    ) -> None:
        module = __import__(
            "tools.modifier.export_insertion",
            fromlist=["_merge_named_export"],
        )

        source = (
            "export {\n"
            "  alpha\n"
            "closing} from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            symbol="beta",
            module="./shared",
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="closing brace indentation",
        ):
            module._merge_named_export(
                context,
                node,
            )


class TestDefensiveRenderingBranches:
    def test_render_binding_without_symbol(
        self,
    ) -> None:
        fake_context = SimpleNamespace(
            normalized_symbol=None,
            normalized_exported_as=None,
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="Missing named export symbol",
        ):
            _render_binding(fake_context)

    def test_render_statement_without_symbol(
        self,
    ) -> None:
        fake_context = SimpleNamespace(
            normalized_module=None,
            normalized_namespace=None,
            normalized_symbol=None,
            normalized_exported_as=None,
            quote_style="'",
            export_all=False,
            type_only=False,
        )

        with pytest.raises(
            InvalidExportInsertion,
            match="Missing named export symbol",
        ):
            _render_statement(fake_context)


class TestRemainingPlannerBranches:
    def test_plan_new_namespace_export(
        self,
    ) -> None:
        context = make_context(
            source="",
            symbol=None,
            module="./shared",
            namespace_export="shared",
        )

        plan = ExportInsertionPlanner().plan(
            context
        )

        assert (
            plan.shape
            == ExportInsertionShape
            .NAMESPACE_EXPORT
        )
        assert plan.text == (
            "export * as shared "
            "from './shared';\n"
        )

    def test_planner_merges_compatible_named_export(
        self,
    ) -> None:
        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        clause_end = source.index("}") + 1

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(
                make_named(
                    local="alpha",
                    start=alpha_start,
                    end=alpha_end,
                ),
            ),
            export_clause_end=clause_end,
        )

        context = make_context(
            source=source,
            exports=(node,),
            symbol="beta",
            module="./shared",
        )

        plan = ExportInsertionPlanner().plan(
            context
        )

        assert (
            plan.shape
            == ExportInsertionShape
            .SINGLE_LINE_NAMED_EXPORT
        )
        assert plan.text == ", beta"


def test_multiline_merge_uses_carriage_return_line_start() -> None:
    module = __import__(
        "tools.modifier.export_insertion",
        fromlist=["_merge_named_export"],
    )

    source = (
        "export {\r"
        "  alpha\r"
        "} from './shared';"
    )

    alpha_start = source.index("alpha")
    alpha_end = alpha_start + len("alpha")
    clause_end = source.index("}") + 1

    node = make_export(
        start=0,
        end=len(source),
        module="./shared",
        named=(
            make_named(
                local="alpha",
                start=alpha_start,
                end=alpha_end,
            ),
        ),
        export_clause_end=clause_end,
    )

    context = make_context(
        source=source,
        symbol="beta",
        module="./shared",
    )

    insertion = module._merge_named_export(
        context,
        node,
    )

    assert (
        insertion.shape
        == ExportInsertionShape
        .MULTILINE_NAMED_EXPORT
    )
    assert "  beta" in insertion.text


def test_multiline_merge_without_closing_line_break() -> None:
    module = __import__(
        "tools.modifier.export_insertion",
        fromlist=["_merge_named_export"],
    )

    source = (
        "export {\n"
        "  alpha}\n"
        "from './shared';"
    )

    alpha_start = source.index("alpha")
    alpha_end = alpha_start + len("alpha")

    clause_end = (
        source.index("\n", alpha_end) + 1
    )

    node = make_export(
        start=0,
        end=len(source),
        module="./shared",
        named=(
            make_named(
                local="alpha",
                start=alpha_start,
                end=alpha_end,
            ),
        ),
        export_clause_end=clause_end,
    )

    context = make_context(
        source=source,
        symbol="beta",
        module="./shared",
    )

    insertion = module._merge_named_export(
        context,
        node,
    )

    assert (
        insertion.shape
        == ExportInsertionShape
        .MULTILINE_NAMED_EXPORT
    )

    assert insertion.text == (
        ",\n"
        "  beta\n"
        "}"
    )
