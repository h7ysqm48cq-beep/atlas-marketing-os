from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import tools.modifier.typescript as typescript_module
from tools.modifier.exceptions import (
    InvalidTypeScriptFile,
    UnsupportedTypeScriptImport,
)
from tools.modifier.import_removal import (
    ImportRemovalAmbiguous,
)
from tools.modifier.typescript import (
    ImportStatement,
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


class TestImportStatement:
    def test_contains_default_namespace_and_named(
        self,
    ) -> None:
        statement = ImportStatement(
            module="./shared",
            symbols=["alpha"],
            default="client",
            namespace="utils",
        )

        assert statement.contains("client")
        assert statement.contains("utils")
        assert statement.contains("alpha")
        assert not statement.contains("missing")

    def test_empty_import_detection(self) -> None:
        assert ImportStatement(
            module="./shared",
        ).is_empty()

        assert not ImportStatement(
            module="./shared",
            symbols=["alpha"],
        ).is_empty()

        assert not ImportStatement(
            module="./shared",
            default="client",
        ).is_empty()

        assert not ImportStatement(
            module="./shared",
            namespace="utils",
        ).is_empty()

        assert not ImportStatement(
            module="./shared",
            side_effect_only=True,
        ).is_empty()

    def test_render_side_effect_import(self) -> None:
        statement = ImportStatement(
            module="./setup",
            side_effect_only=True,
        )

        assert statement.render() == (
            "import './setup';"
        )

    def test_render_combined_import(self) -> None:
        statement = ImportStatement(
            module="./shared",
            symbols=[
                "gamma",
                "alpha",
                "gamma",
            ],
            default="client",
            namespace="utils",
        )

        assert statement.render() == (
            "import client, * as utils, "
            "{ alpha, gamma } "
            "from './shared';"
        )

    def test_empty_import_cannot_render(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Cannot render empty import",
        ):
            ImportStatement(
                module="./shared",
            ).render()


class TestTypeScriptFileLoading:
    def test_invalid_suffix_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "invalid.js",
            "",
        )

        with pytest.raises(
            InvalidTypeScriptFile,
            match=r"\.ts or \.tsx",
        ):
            TypeScriptFile.load(path)

    def test_missing_typescript_file(
        self,
        temp_workspace: Path,
    ) -> None:
        path = (
            temp_workspace
            / "missing.ts"
        )

        with pytest.raises(
            FileNotFoundError,
        ):
            TypeScriptFile.load(path)

    def test_tsx_file_is_supported(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "component.tsx",
            "export const View = () => <div />;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.path == path
        assert file.source().startswith(
            "export const View"
        )


class TestLegacyImportParsing:
    def test_split_multiple_import_blocks(
        self,
    ) -> None:
        blocks, body = (
            TypeScriptFile
            ._split_import_blocks(
                "\n"
                "import client from './client';\n"
                "\n"
                "import {\n"
                "  alpha,\n"
                "  beta,\n"
                "} from './shared';\n"
                "\n"
                "const value = alpha;\n"
            )
        )

        assert blocks == [
            "import client from './client';",
            (
                "import {\n"
                "  alpha,\n"
                "  beta,\n"
                "} from './shared';"
            ),
        ]

        assert body == (
            "const value = alpha;\n"
        )

    def test_split_multiline_collecting_branch(
        self,
    ) -> None:
        blocks, body = (
            TypeScriptFile
            ._split_import_blocks(
                "import {\n"
                "  alpha,\n"
                "} from './shared';\n"
                "const value = alpha;\n"
            )
        )

        assert len(blocks) == 1
        assert body == (
            "const value = alpha;\n"
        )

    def test_unterminated_import_rejected(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Unterminated",
        ):
            TypeScriptFile._split_import_blocks(
                "import {\n"
                "  alpha,\n"
            )

    def test_parse_side_effect_import(
        self,
    ) -> None:
        statement = (
            TypeScriptFile
            ._parse_import(
                'import "./setup";'
            )
        )

        assert statement.module == "./setup"
        assert statement.side_effect_only

    def test_parse_default_named_namespace(
        self,
    ) -> None:
        statement = (
            TypeScriptFile
            ._parse_import(
                "import client, "
                "* as utils, "
                "{ alpha, beta } "
                "from './shared';"
            )
        )

        assert statement.module == "./shared"
        assert statement.default == "client"
        assert statement.namespace == "utils"
        assert statement.symbols == [
            "alpha",
            "beta",
        ]

    def test_parse_unsupported_syntax(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Unsupported import syntax",
        ):
            TypeScriptFile._parse_import(
                "const value = 1;"
            )

    def test_parse_invalid_remaining_clause(
        self,
    ) -> None:
        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Unsupported import clause",
        ):
            TypeScriptFile._parse_import(
                "import client extra "
                "from './shared';"
            )

    def test_parse_source(self) -> None:
        imports, body = (
            TypeScriptFile._parse_source(
                "import client "
                "from './client';\n"
                "\n"
                "const value = client;\n"
            )
        )

        assert len(imports) == 1
        assert imports[0].default == "client"
        assert body == (
            "const value = client;\n"
        )


class TestImportListing:
    def test_list_imports_returns_copies(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "listing.ts",
            (
                "import { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)
        listed = file.list_imports()

        assert listed[0].module == "./shared"
        assert listed[0].symbols == ["alpha"]

        listed[0].module = "./changed"
        listed[0].symbols.append("beta")

        second = file.list_imports()

        assert second[0].module == "./shared"
        assert second[0].symbols == ["alpha"]


class TestHasImport:
    def test_symbol_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "has-import-type.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            file.has_import(123)

    def test_symbol_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "has-import-empty.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            file.has_import(" ")

    def test_finds_local_and_imported_alias(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "has-import-alias.ts",
            (
                "import { alpha as beta } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.has_import("alpha")
        assert file.has_import("beta")

        assert file.has_import(
            "alpha",
            "./shared",
        )

        assert not file.has_import(
            "alpha",
            "./other",
        )

        assert not file.has_import(
            "missing"
        )


class TestAddImportRemainingBranches:
    def test_default_flag_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "default-type.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="default must be a boolean",
        ):
            file.add_import(
                "client",
                "./client",
                default=1,
            )

    def test_editor_reporting_no_change(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "editor-no-change.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        monkeypatch.setattr(
            typescript_module.BridgeEditor,
            "apply",
            lambda self: False,
        )

        assert file.add_import(
            "client",
            "./client",
        ) is False

        assert file.source() == ""
        assert file.operations == []
        assert file.dirty is False


class TestRemoveImportValidation:
    def test_symbol_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-symbol-type.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            file.remove_import(123)

    def test_module_must_be_string_or_none(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-module-type.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            TypeError,
            match="string or None",
        ):
            file.remove_import(
                "alpha",
                123,
            )

    def test_symbol_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-empty-symbol.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            file.remove_import(" ")

    def test_module_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-empty-module.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            ValueError,
            match="from_module cannot be empty",
        ):
            file.remove_import(
                "alpha",
                " ",
            )


class TestRemoveImport:
    def test_missing_symbol_without_module(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-missing.ts",
            (
                "import { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "missing"
        ) is False

        assert file.operations == []
        assert not file.dirty

    def test_missing_symbol_from_module(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-module-missing.ts",
            (
                "import { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "missing",
            "./shared",
        ) is False

    def test_symbol_in_multiple_modules_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-multiple.ts",
            (
                "import { alpha } from './first';\n"
                "import { alpha } from './second';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="multiple modules",
        ):
            file.remove_import("alpha")

    def test_remove_named_import_by_imported_name(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-imported.ts",
            (
                "import { alpha as beta, gamma } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "alpha"
        )

        assert file.source() == (
            "import { gamma } "
            "from './shared';\n"
        )

        assert file.operations[-1][
            "action"
        ] == "remove_import"

        assert file.operations[-1][
            "module"
        ] == "./shared"

        assert file.dirty

    def test_remove_named_import_by_local_name(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-local.ts",
            (
                "import { alpha as beta, gamma } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "beta"
        )

        assert "alpha as beta" not in (
            file.source()
        )
        assert "gamma" in file.source()

    def test_remove_default_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-default.ts",
            (
                "import client, { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "client"
        )

        assert file.source() == (
            "import { alpha } "
            "from './shared';\n"
        )

    def test_remove_namespace_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-namespace.ts",
            (
                "import * as utils "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "utils"
        )

        assert file.source() == ""

    def test_remove_with_explicit_module(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-explicit.ts",
            (
                "import { alpha } from './first';\n"
                "import { beta } from './second';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        assert file.remove_import(
            "beta",
            "./second",
        )

        assert "./first" in file.source()
        assert "./second" not in file.source()

    def test_planner_ambiguity_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-planner-ambiguous.ts",
            (
                "import { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)

        def raise_ambiguous(
            self,
            context,
        ):
            raise ImportRemovalAmbiguous(
                "ambiguous test import"
            )

        monkeypatch.setattr(
            typescript_module
            .ImportRemovalPlanner,
            "plan",
            raise_ambiguous,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="ambiguous test import",
        ):
            file.remove_import(
                "alpha",
                "./shared",
            )

    def test_editor_reporting_no_change(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        path = write_source(
            temp_workspace,
            "remove-no-change.ts",
            (
                "import { alpha } "
                "from './shared';\n"
            ),
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        monkeypatch.setattr(
            typescript_module.BridgeEditor,
            "apply",
            lambda self: False,
        )

        assert file.remove_import(
            "alpha",
            "./shared",
        ) is False

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False
