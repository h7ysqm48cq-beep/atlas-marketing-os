from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ImportNode,
    NamedImportNode,
)
from tools.modifier.import_removal import (
    ImportRemovalAmbiguous,
    ImportRemovalContext,
    ImportRemovalNotFound,
    ImportRemovalPlanner,
    ImportRemovalShape,
    _delete_declaration,
    _named_imported_name,
    _named_local_name,
    _named_matches,
    _remove_default,
    _remove_named_import,
    _remove_namespace,
    _remove_only_named_import,
)


def make_named(
    *,
    imported: str,
    local: str | None = None,
    start: int = 0,
    end: int = 0,
) -> NamedImportNode:
    return NamedImportNode(
        raw={
            "imported": imported,
            "local": (
                imported
                if local is None
                else local
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


def make_import(
    *,
    start: int,
    end: int,
    module: str,
    default_import: str | None = None,
    namespace_import: str | None = None,
    named=(),
    import_clause_start: int | None = None,
    import_clause_end: int | None = None,
    named_bindings_start: int | None = None,
    named_bindings_end: int | None = None,
) -> ImportNode:
    return ImportNode(
        raw={
            "module": module,
            "quoteStyle": "'",
            "sideEffectOnly": False,
            "defaultImport": default_import,
            "namespaceImport": namespace_import,
            "namedImports": [
                item.raw
                for item in named
            ],
            "typeOnly": False,
            "importClauseStart": (
                start + len("import ")
                if import_clause_start is None
                else import_clause_start
            ),
            "importClauseEnd": (
                end
                if import_clause_end is None
                else import_clause_end
            ),
            "namedBindingsStart": (
                named_bindings_start
            ),
            "namedBindingsEnd": (
                named_bindings_end
            ),
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
    source: str,
    module: str,
    symbol: str,
    imports,
) -> ImportRemovalContext:
    return ImportRemovalContext(
        source=source,
        module=module,
        symbol=symbol,
        imports=list(imports),
    )


class TestNamedHelpers:
    def test_imported_name_found(self) -> None:
        named = make_named(
            imported="alpha",
            local="beta",
        )

        assert (
            _named_imported_name(named)
            == "alpha"
        )

    def test_local_name_found(self) -> None:
        named = make_named(
            imported="alpha",
            local="beta",
        )

        assert (
            _named_local_name(named)
            == "beta"
        )

    def test_helper_returns_none_without_names(
        self,
    ) -> None:
        node = SimpleNamespace()

        assert (
            _named_imported_name(node)
            is None
        )

        assert (
            _named_local_name(node)
            is None
        )

    def test_matches_imported_name(self) -> None:
        named = make_named(
            imported="alpha",
            local="beta",
        )

        assert _named_matches(
            named,
            "alpha",
        )

    def test_matches_local_name(self) -> None:
        named = make_named(
            imported="alpha",
            local="beta",
        )

        assert _named_matches(
            named,
            "beta",
        )

    def test_named_does_not_match(self) -> None:
        named = make_named(
            imported="alpha",
            local="beta",
        )

        assert not _named_matches(
            named,
            "gamma",
        )


class TestDeleteDeclarationBranches:
    def test_consumes_crlf(self) -> None:
        source = (
            "import Alpha from './shared';\r\n"
            "const value = 1;\r\n"
        )

        end = source.index("\r\n")

        node = make_import(
            start=0,
            end=end,
            module="./shared",
            default_import="Alpha",
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.start == 0
        assert removal.end == end + 2
        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_consumes_lf(self) -> None:
        source = (
            "import Alpha from './shared';\n"
            "const value = 1;\n"
        )

        end = source.index("\n")

        node = make_import(
            start=0,
            end=end,
            module="./shared",
            default_import="Alpha",
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.end == end + 1

    def test_without_line_ending(self) -> None:
        source = (
            "import Alpha from './shared';"
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            default_import="Alpha",
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = _delete_declaration(
            context,
            node,
        )

        assert removal.end == len(source)


class TestDefaultRemovalBranches:
    def test_default_only_deletes_declaration(
        self,
    ) -> None:
        source = (
            "import Alpha from './shared';\n"
        )

        node = make_import(
            start=0,
            end=source.index("\n"),
            module="./shared",
            default_import="Alpha",
            named_bindings_start=None,
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = _remove_default(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_default_removed_from_combined_import(
        self,
    ) -> None:
        source = (
            "import Alpha, { beta } "
            "from './shared';"
        )

        clause_start = source.index("Alpha")
        bindings_start = source.index("{")
        clause_end = source.index(" from")

        beta_start = source.index("beta")
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            default_import="Alpha",
            named=(beta,),
            import_clause_start=clause_start,
            import_clause_end=clause_end,
            named_bindings_start=bindings_start,
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = _remove_default(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .DEFAULT_IMPORT
        )
        assert removal.start == clause_start
        assert removal.end == bindings_start


class TestNamespaceRemovalBranches:
    def test_namespace_with_default_keeps_default(
        self,
    ) -> None:
        source = (
            "import Alpha, * as Shared "
            "from './shared';"
        )

        clause_start = source.index("Alpha")
        clause_end = source.index(" from")
        bindings_start = source.index("*")

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            default_import="Alpha",
            namespace_import="Shared",
            import_clause_start=clause_start,
            import_clause_end=clause_end,
            named_bindings_start=bindings_start,
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Shared",
            imports=(node,),
        )

        removal = _remove_namespace(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .NAMESPACE_IMPORT
        )
        assert removal.text == "Alpha"

    def test_namespace_only_deletes_declaration(
        self,
    ) -> None:
        source = (
            "import * as Shared "
            "from './shared';\n"
        )

        node = make_import(
            start=0,
            end=source.index("\n"),
            module="./shared",
            namespace_import="Shared",
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Shared",
            imports=(node,),
        )

        removal = _remove_namespace(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )


class TestOnlyNamedRemovalBranches:
    def test_only_named_with_default_keeps_default(
        self,
    ) -> None:
        source = (
            "import Alpha, { beta } "
            "from './shared';"
        )

        clause_start = source.index("Alpha")
        clause_end = source.index(" from")
        bindings_start = source.index("{")

        beta_start = source.index("beta")
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            default_import="Alpha",
            named=(beta,),
            import_clause_start=clause_start,
            import_clause_end=clause_end,
            named_bindings_start=bindings_start,
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="beta",
            imports=(node,),
        )

        removal = _remove_only_named_import(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .LAST_NAMED_IMPORT
        )
        assert removal.text == "Alpha"

    def test_only_named_without_default_deletes(
        self,
    ) -> None:
        source = (
            "import { beta } from './shared';\n"
        )

        beta_start = source.index("beta")
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=source.index("\n"),
            module="./shared",
            named=(beta,),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="beta",
            imports=(node,),
        )

        removal = _remove_only_named_import(
            context,
            node,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )


class TestNamedRemovalBranches:
    def test_single_named_uses_only_named_path(
        self,
    ) -> None:
        source = (
            "import { alpha } from './shared';"
        )

        start = source.index("alpha")
        alpha = make_named(
            imported="alpha",
            start=start,
            end=start + 5,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha,),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="alpha",
            imports=(node,),
        )

        removal = _remove_named_import(
            context,
            node,
            alpha,
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_remove_non_final_named_import(
        self,
    ) -> None:
        source = (
            "import { alpha, beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        alpha = make_named(
            imported="alpha",
            start=alpha_start,
            end=alpha_start + 5,
        )
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha, beta),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="alpha",
            imports=(node,),
        )

        removal = _remove_named_import(
            context,
            node,
            alpha,
        )

        assert (
            removal.shape
            == ImportRemovalShape.NAMED_IMPORT
        )
        assert removal.start == alpha.start
        assert removal.end == beta.start

    def test_remove_final_named_import(
        self,
    ) -> None:
        source = (
            "import { alpha, beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        alpha = make_named(
            imported="alpha",
            start=alpha_start,
            end=alpha_start + 5,
        )
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha, beta),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="beta",
            imports=(node,),
        )

        removal = _remove_named_import(
            context,
            node,
            beta,
        )

        assert removal.start == alpha.end
        assert removal.end == beta.end


class TestPlannerValidation:
    def test_source_must_be_string(self) -> None:
        context = ImportRemovalContext(
            source=123,
            module="./shared",
            symbol="alpha",
            imports=[],
        )

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            ImportRemovalPlanner().plan(context)

    def test_module_must_be_string(self) -> None:
        context = ImportRemovalContext(
            source="",
            module=123,
            symbol="alpha",
            imports=[],
        )

        with pytest.raises(
            TypeError,
            match="module must be a string",
        ):
            ImportRemovalPlanner().plan(context)

    def test_symbol_must_be_string(self) -> None:
        context = ImportRemovalContext(
            source="",
            module="./shared",
            symbol=123,
            imports=[],
        )

        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            ImportRemovalPlanner().plan(context)

    def test_empty_module_rejected(self) -> None:
        context = ImportRemovalContext(
            source="",
            module="   ",
            symbol="alpha",
            imports=[],
        )

        with pytest.raises(
            ValueError,
            match="module cannot be empty",
        ):
            ImportRemovalPlanner().plan(context)

    def test_empty_symbol_rejected(self) -> None:
        context = ImportRemovalContext(
            source="",
            module="./shared",
            symbol="   ",
            imports=[],
        )

        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            ImportRemovalPlanner().plan(context)


class TestPlannerMatchingBranches:
    def test_other_module_is_skipped(self) -> None:
        source = (
            "import { alpha } from './one';"
        )

        alpha_start = source.index("alpha")
        alpha = make_named(
            imported="alpha",
            start=alpha_start,
            end=alpha_start + 5,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./one",
            named=(alpha,),
        )

        context = make_context(
            source=source,
            module="./two",
            symbol="alpha",
            imports=(node,),
        )

        with pytest.raises(
            ImportRemovalNotFound,
            match="'./two'",
        ):
            ImportRemovalPlanner().plan(context)

    def test_default_import_removed(self) -> None:
        source = (
            "import Alpha from './shared';"
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            default_import="Alpha",
            named_bindings_start=None,
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Alpha",
            imports=(node,),
        )

        removal = ImportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_namespace_import_removed(self) -> None:
        source = (
            "import * as Shared "
            "from './shared';"
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            namespace_import="Shared",
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="Shared",
            imports=(node,),
        )

        removal = ImportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_named_local_alias_removed(
        self,
    ) -> None:
        source = (
            "import { alpha as beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_end = source.index("beta") + 4

        named = make_named(
            imported="alpha",
            local="beta",
            start=alpha_start,
            end=beta_end,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(named,),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="beta",
            imports=(node,),
        )

        removal = ImportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ImportRemovalShape
            .IMPORT_DECLARATION
        )

    def test_named_loop_reaches_later_match(
        self,
    ) -> None:
        source = (
            "import { alpha, beta } "
            "from './shared';"
        )

        alpha_start = source.index("alpha")
        beta_start = source.index("beta")

        alpha = make_named(
            imported="alpha",
            start=alpha_start,
            end=alpha_start + 5,
        )
        beta = make_named(
            imported="beta",
            start=beta_start,
            end=beta_start + 4,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha, beta),
            named_bindings_start=source.index("{"),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="beta",
            imports=(node,),
        )

        removal = ImportRemovalPlanner().plan(
            context
        )

        assert (
            removal.shape
            == ImportRemovalShape.NAMED_IMPORT
        )

    def test_not_found_rejected(self) -> None:
        context = make_context(
            source="",
            module="./shared",
            symbol="missing",
            imports=(),
        )

        with pytest.raises(
            ImportRemovalNotFound,
            match="No import named",
        ):
            ImportRemovalPlanner().plan(
                context
            )

    def test_ambiguous_import_rejected(
        self,
    ) -> None:
        source = (
            "import { alpha } from './shared';\n"
            "import { alpha } from './shared';"
        )

        first_start = source.index("alpha")
        second_start = source.rindex("alpha")

        first_named = make_named(
            imported="alpha",
            start=first_start,
            end=first_start + 5,
        )
        second_named = make_named(
            imported="alpha",
            start=second_start,
            end=second_start + 5,
        )

        first_end = source.index("\n")
        second_import_start = first_end + 1

        first = make_import(
            start=0,
            end=first_end,
            module="./shared",
            named=(first_named,),
        )
        second = make_import(
            start=second_import_start,
            end=len(source),
            module="./shared",
            named=(second_named,),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="alpha",
            imports=(first, second),
        )

        with pytest.raises(
            ImportRemovalAmbiguous,
            match="Multiple imports",
        ):
            ImportRemovalPlanner().plan(
                context
            )

    def test_duplicate_identity_deduplicated(
        self,
    ) -> None:
        source = (
            "import { alpha } from './shared';"
        )

        alpha_start = source.index("alpha")
        alpha = make_named(
            imported="alpha",
            start=alpha_start,
            end=alpha_start + 5,
        )

        node = make_import(
            start=0,
            end=len(source),
            module="./shared",
            named=(alpha,),
        )

        context = make_context(
            source=source,
            module="./shared",
            symbol="alpha",
            imports=(node, node),
        )

        removal = ImportRemovalPlanner().plan(
            context
        )

        assert removal is not None
