from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ExportNode,
    NamedExportNode,
)
from tools.modifier.export_removal import (
    ExportRemovalAmbiguous,
    ExportRemovalContext,
    ExportRemovalError,
    ExportRemovalNotFound,
    ExportRemovalPlanner,
    ExportRemovalShape,
    _delete_declaration,
    _named_matches,
    _remove_named_export,
)


def make_named(
    *,
    local: str,
    exported: str | None = None,
    start: int = 0,
    end: int = 0,
) -> NamedExportNode:
    return NamedExportNode(
        raw={
            "local": local,
            "exported": (
                local
                if exported is None
                else exported
            ),
            "typeOnly": False,
            "start": start,
            "end": end,
            "startLine": 1,
            "startColumn": 1,
            "endLine": 1,
            "endColumn": 1,
        }
    )


def make_export(
    *,
    start: int,
    end: int,
    module: str | None = None,
    export_all: bool = False,
    namespace_export: str | None = None,
    named=(),
) -> ExportNode:
    return ExportNode(
        raw={
            "module": module,
            "quoteStyle": "'",
            "exportAll": export_all,
            "namespaceExport": namespace_export,
            "namedExports": [
                item.raw
                for item in named
            ],
            "typeOnly": False,
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
    source: str,
    symbol: str,
    exports,
    module: str | None = None,
) -> ExportRemovalContext:
    return ExportRemovalContext(
        source=source,
        symbol=symbol,
        exports=tuple(exports),
        module=module,
    )


class TestHelpers:
    def test_named_matches_local(self) -> None:
        named = make_named(
            local="alpha",
            exported="beta",
        )

        assert _named_matches(
            named,
            "alpha",
        )

    def test_named_matches_exported(self) -> None:
        named = make_named(
            local="alpha",
            exported="beta",
        )

        assert _named_matches(
            named,
            "beta",
        )

    def test_named_does_not_match(self) -> None:
        named = make_named(
            local="alpha",
            exported="beta",
        )

        assert not _named_matches(
            named,
            "gamma",
        )


class TestDeleteDeclarationBranches:
    def test_consumes_crlf(self) -> None:
        source = (
            "export * from './shared';\r\n"
            "const value = 1;\r\n"
        )

        end = source.index("\r\n")

        node = make_export(
            start=0,
            end=end,
            module="./shared",
            export_all=True,
        )

        context = make_context(
            source=source,
            symbol="*",
            exports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.start == 0
        assert removal.end == end + 2
        assert removal.text == ""

    def test_consumes_lf(self) -> None:
        source = (
            "export * from './shared';\n"
            "const value = 1;\n"
        )

        end = source.index("\n")

        node = make_export(
            start=0,
            end=end,
            module="./shared",
            export_all=True,
        )

        context = make_context(
            source=source,
            symbol="*",
            exports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.end == end + 1

    def test_no_line_ending_to_consume(
        self,
    ) -> None:
        source = "export * from './shared';"

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            export_all=True,
        )

        context = make_context(
            source=source,
            symbol="*",
            exports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.end == len(source)


class TestRemoveNamedExportBranches:
    def test_single_named_export_removes_declaration(
        self,
    ) -> None:
        source = (
            "export { alpha } from './shared';\n"
        )

        named_start = source.index("alpha")
        named_end = named_start + len("alpha")

        named = make_named(
            local="alpha",
            start=named_start,
            end=named_end,
        )

        node = make_export(
            start=0,
            end=source.index("\n"),
            module="./shared",
            named=(named,),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(node,),
        )

        removal = _remove_named_export(
            context,
            node,
            named,
        )

        assert (
            removal.shape
            == ExportRemovalShape.EXPORT_DECLARATION
        )
        assert removal.start == 0
        assert removal.end == len(source)

    def test_remove_non_final_named_export(
        self,
    ) -> None:
        source = (
            "export { alpha, beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        beta_start = source.index("beta")
        beta_end = beta_start + len("beta")

        alpha = make_named(
            local="alpha",
            start=alpha_start,
            end=alpha_end,
        )
        beta = make_named(
            local="beta",
            start=beta_start,
            end=beta_end,
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha, beta),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(node,),
        )

        removal = _remove_named_export(
            context,
            node,
            alpha,
        )

        assert (
            removal.shape
            == ExportRemovalShape.NAMED_EXPORT
        )
        assert removal.start == alpha_start
        assert removal.end == beta_start

    def test_remove_final_named_export(
        self,
    ) -> None:
        source = (
            "export { alpha, beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")
        beta_start = source.index("beta")
        beta_end = beta_start + len("beta")

        alpha = make_named(
            local="alpha",
            start=alpha_start,
            end=alpha_end,
        )
        beta = make_named(
            local="beta",
            start=beta_start,
            end=beta_end,
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha, beta),
        )

        context = make_context(
            source=source,
            symbol="beta",
            exports=(node,),
        )

        removal = _remove_named_export(
            context,
            node,
            beta,
        )

        assert removal.start == alpha_end
        assert removal.end == beta_end


class TestPlannerValidation:
    def test_source_must_be_string(self) -> None:
        context = ExportRemovalContext(
            source=123,
            symbol="alpha",
            exports=(),
        )

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_symbol_must_be_string(self) -> None:
        context = ExportRemovalContext(
            source="",
            symbol=123,
            exports=(),
        )

        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_module_must_be_string_or_none(
        self,
    ) -> None:
        context = ExportRemovalContext(
            source="",
            symbol="alpha",
            exports=(),
            module=123,
        )

        with pytest.raises(
            TypeError,
            match="module must be a string or None",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_exports_must_be_tuple(self) -> None:
        context = ExportRemovalContext(
            source="",
            symbol="alpha",
            exports=[],
        )

        with pytest.raises(
            TypeError,
            match="exports must be a tuple",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_exports_must_contain_export_nodes(
        self,
    ) -> None:
        context = ExportRemovalContext(
            source="",
            symbol="alpha",
            exports=(
                SimpleNamespace(),
            ),
        )

        with pytest.raises(
            TypeError,
            match="ExportNode objects",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_empty_symbol_rejected(self) -> None:
        context = ExportRemovalContext(
            source="",
            symbol="   ",
            exports=(),
        )

        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_empty_module_rejected(self) -> None:
        context = ExportRemovalContext(
            source="",
            symbol="alpha",
            exports=(),
            module="   ",
        )

        with pytest.raises(
            ValueError,
            match="module cannot be empty",
        ):
            ExportRemovalPlanner().plan(
                context
            )


class TestPlannerMatching:
    def test_module_filter_skips_other_modules(
        self,
    ) -> None:
        source = (
            "export { alpha } from './one';\n"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")

        alpha = make_named(
            local="alpha",
            start=alpha_start,
            end=alpha_end,
        )

        node = make_export(
            start=0,
            end=source.index("\n"),
            module="./one",
            named=(alpha,),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(node,),
            module="./two",
        )

        with pytest.raises(
            ExportRemovalNotFound,
            match="from './two'",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_star_export_removed(self) -> None:
        source = (
            "export * from './shared';\n"
        )

        node = make_export(
            start=0,
            end=source.index("\n"),
            module="./shared",
            export_all=True,
        )

        context = make_context(
            source=source,
            symbol="*",
            exports=(node,),
        )

        removal = ExportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ExportRemovalShape.STAR_EXPORT
        )

    def test_star_symbol_ignores_named_export(
        self,
    ) -> None:
        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")

        alpha = make_named(
            local="alpha",
            start=alpha_start,
            end=alpha_end,
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha,),
        )

        context = make_context(
            source=source,
            symbol="*",
            exports=(node,),
        )

        with pytest.raises(
            ExportRemovalNotFound,
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_namespace_export_removed(
        self,
    ) -> None:
        source = (
            "export * as shared from './shared';\n"
        )

        node = make_export(
            start=0,
            end=source.index("\n"),
            module="./shared",
            namespace_export="shared",
        )

        context = make_context(
            source=source,
            symbol="shared",
            exports=(node,),
        )

        removal = ExportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ExportRemovalShape.NAMESPACE_EXPORT
        )

    def test_named_local_match_removed(
        self,
    ) -> None:
        source = (
            "export { alpha as beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        named = make_named(
            local="alpha",
            exported="beta",
            start=alpha_start,
            end=beta_start + len("beta"),
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(named,),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(node,),
        )

        removal = ExportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ExportRemovalShape.EXPORT_DECLARATION
        )

    def test_named_exported_match_removed(
        self,
    ) -> None:
        source = (
            "export { alpha as beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        named = make_named(
            local="alpha",
            exported="beta",
            start=alpha_start,
            end=beta_start + len("beta"),
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(named,),
        )

        context = make_context(
            source=source,
            symbol="beta",
            exports=(node,),
        )

        removal = ExportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ExportRemovalShape.EXPORT_DECLARATION
        )

    def test_not_found_without_module(
        self,
    ) -> None:
        context = make_context(
            source="",
            symbol="missing",
            exports=(),
        )

        with pytest.raises(
            ExportRemovalNotFound,
            match="No export named 'missing'",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_ambiguous_named_export_rejected(
        self,
    ) -> None:
        source = (
            "export { alpha } from './one';\n"
            "export { alpha } from './two';\n"
        )

        first_start = source.index("alpha")
        second_start = source.rindex("alpha")

        first_named = make_named(
            local="alpha",
            start=first_start,
            end=first_start + 5,
        )
        second_named = make_named(
            local="alpha",
            start=second_start,
            end=second_start + 5,
        )

        first_end = source.index("\n")
        second_export_start = first_end + 1

        first = make_export(
            start=0,
            end=first_end,
            module="./one",
            named=(first_named,),
        )
        second = make_export(
            start=second_export_start,
            end=len(source) - 1,
            module="./two",
            named=(second_named,),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(first, second),
        )

        with pytest.raises(
            ExportRemovalAmbiguous,
            match="Multiple exports",
        ):
            ExportRemovalPlanner().plan(
                context
            )

    def test_duplicate_identity_is_deduplicated(
        self,
    ) -> None:
        source = (
            "export { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha_end = alpha_start + len("alpha")

        named = make_named(
            local="alpha",
            start=alpha_start,
            end=alpha_end,
        )

        node = make_export(
            start=0,
            end=len(source),
            module="./shared",
            named=(named,),
        )

        context = make_context(
            source=source,
            symbol="alpha",
            exports=(node, node),
        )

        removal = ExportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ExportRemovalShape.EXPORT_DECLARATION
        )


def test_named_loop_continues_until_later_match() -> None:
    source = (
        "export { alpha, beta } "
        "from './shared';"
    )

    alpha_start = source.index("alpha")
    beta_start = source.index("beta")

    alpha = make_named(
        local="alpha",
        start=alpha_start,
        end=alpha_start + len("alpha"),
    )

    beta = make_named(
        local="beta",
        start=beta_start,
        end=beta_start + len("beta"),
    )

    node = make_export(
        start=0,
        end=len(source),
        module="./shared",
        named=(alpha, beta),
    )

    context = make_context(
        source=source,
        symbol="beta",
        exports=(node,),
    )

    removal = ExportRemovalPlanner().plan(
        context
    )

    assert (
        removal.shape
        == ExportRemovalShape.NAMED_EXPORT
    )
    assert removal.end == beta.end
