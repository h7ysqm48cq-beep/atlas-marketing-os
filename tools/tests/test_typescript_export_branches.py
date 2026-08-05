from __future__ import annotations

from pathlib import Path

import pytest

import tools.modifier.typescript as typescript_module
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.export_insertion import (
    DuplicateExportSymbol,
    InvalidExportInsertion,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_source(
    workspace: Path,
    filename: str,
    source: str,
) -> Path:
    path = workspace / filename
    path.write_text(
        source,
        encoding="utf-8",
    )
    return path


class TestAddExportValidation:
    def test_symbol_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-symbol-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            file.add_export(123)

    def test_symbol_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-symbol-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            file.add_export(" ")

    def test_module_must_be_string_or_none(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-module-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="from_module must be a string or None",
        ):
            file.add_export(
                "alpha",
                123,
            )

    def test_module_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-module-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="from_module cannot be empty",
        ):
            file.add_export(
                "alpha",
                " ",
            )

    def test_exported_as_must_be_string_or_none(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-alias-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="exported_as must be a string or None",
        ):
            file.add_export(
                "alpha",
                exported_as=123,
            )

    def test_exported_as_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-alias-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="exported_as cannot be empty",
        ):
            file.add_export(
                "alpha",
                exported_as=" ",
            )

    def test_type_only_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-type-only.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="type_only must be a boolean",
        ):
            file.add_export(
                "Alpha",
                type_only=1,
            )


class TestAddExportAllValidation:
    def test_module_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-all-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="from_module must be a string",
        ):
            file.add_export_all(123)

    def test_module_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-all-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="from_module cannot be empty",
        ):
            file.add_export_all(" ")


class TestNamespaceExportValidation:
    def test_namespace_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "namespace-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="namespace must be a string",
        ):
            file.add_namespace_export(
                123,
                "./shared",
            )

    def test_module_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "namespace-module-type.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="from_module must be a string",
        ):
            file.add_namespace_export(
                "Shared",
                123,
            )

    def test_namespace_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "namespace-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="namespace cannot be empty",
        ):
            file.add_namespace_export(
                " ",
                "./shared",
            )

    def test_module_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "namespace-module-empty.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="from_module cannot be empty",
        ):
            file.add_namespace_export(
                "Shared",
                " ",
            )


class TestExportInsertion:
    def test_add_local_export(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "local-export.ts",
            "const alpha = 1;\n",
        )
        file = TypeScriptFile.load(path)

        assert file.add_export("alpha")

        assert file.source() == (
            "const alpha = 1;\n"
            "\n"
            "export { alpha };\n"
        )

        operation = file.operations[-1]
        assert operation["action"] == "add_export"
        assert operation["symbol"] == "alpha"
        assert operation["module"] is None
        assert operation["engine"] == "typescript_ast"
        assert file.dirty

    def test_add_reexport(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "reexport.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "alpha",
            "./shared",
        )

        assert file.source() == (
            "export { alpha } "
            "from './shared';\n"
        )

    def test_add_aliased_export(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "alias-export.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "alpha",
            "./shared",
            exported_as="beta",
        )

        assert "alpha as beta" in file.source()

    def test_add_type_only_export(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "type-export.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "Alpha",
            "./shared",
            type_only=True,
        )

        assert "export type" in file.source()
        assert "Alpha" in file.source()

    def test_add_export_all(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-all.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        assert file.add_export_all(
            "./shared"
        )

        assert file.source() == (
            "export * from './shared';\n"
        )

    def test_add_namespace_export(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "namespace-export.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        assert file.add_namespace_export(
            "Shared",
            "./shared",
        )

        assert file.source() == (
            "export * as Shared "
            "from './shared';\n"
        )

    def test_duplicate_export_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        source = (
            "export { alpha } "
            "from './shared';\n"
        )
        path = write_source(
            temp_workspace,
            "duplicate-export.ts",
            source,
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "alpha",
            "./shared",
        ) is False

        assert file.source() == source
        assert file.operations == []
        assert not file.dirty


class TestExportQuoteStyle:
    def test_matching_export_quote_used(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "matching-export-quote.ts",
            (
                'export { alpha } '
                'from "./shared";\n'
            ),
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "beta",
            "./shared",
        )

        assert (
            'from "./shared";'
            in file.source()
        )

    def test_matching_import_quote_used(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "matching-import-quote.ts",
            (
                'import { alpha } '
                'from "./shared";\n'
            ),
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "beta",
            "./shared",
        )

        assert (
            'from "./shared";'
            in file.source()
        )

    def test_first_export_quote_used(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "first-export-quote.ts",
            (
                'export { alpha } '
                'from "./first";\n'
            ),
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "beta",
            "./second",
        )

        assert (
            'from "./second";'
            in file.source()
        )

    def test_first_import_quote_used(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "first-import-quote.ts",
            (
                'import { alpha } '
                'from "./first";\n'
            ),
        )
        file = TypeScriptFile.load(path)

        assert file.add_export(
            "beta",
            "./second",
        )

        assert (
            'from "./second";'
            in file.source()
        )


class TestExportInsertionErrors:
    def test_invalid_plan_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "invalid-export-plan.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        def invalid_plan(
            self,
            context,
        ):
            raise InvalidExportInsertion(
                "invalid export test"
            )

        monkeypatch.setattr(
            typescript_module
            .ExportInsertionPlanner,
            "plan",
            invalid_plan,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="invalid export test",
        ):
            file.add_export(
                "alpha",
                "./shared",
            )

    def test_duplicate_planner_result_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "duplicate-plan.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        def duplicate_plan(
            self,
            context,
        ):
            raise DuplicateExportSymbol(
                "duplicate export test"
            )

        monkeypatch.setattr(
            typescript_module
            .ExportInsertionPlanner,
            "plan",
            duplicate_plan,
        )

        assert file.add_export(
            "alpha",
            "./shared",
        ) is False

        assert file.operations == []
        assert not file.dirty

    def test_editor_reporting_no_change(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "export-no-change.ts",
            "",
        )
        file = TypeScriptFile.load(path)

        monkeypatch.setattr(
            typescript_module.BridgeEditor,
            "apply",
            lambda self: False,
        )

        assert file.add_export(
            "alpha",
            "./shared",
        ) is False

        assert file.source() == ""
        assert file.operations == []
        assert not file.dirty
