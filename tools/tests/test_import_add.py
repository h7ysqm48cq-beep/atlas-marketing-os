from __future__ import annotations

from pathlib import Path

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
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


class TestNamedImportAdd:
    def test_add_named_import_to_empty_file(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "empty.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
        )

        assert file.source() == (
            "import { client } "
            "from './client';\n"
        )

    def test_add_named_import_before_code(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "before-code.ts",
            """const value = 1;
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
        )

        assert file.source() == """import { client } from './client';

const value = 1;
"""

    def test_merge_named_import_same_module(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "merge.ts",
            """import { alpha } from "./shared";

const value = alpha;
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "beta",
            "./shared",
        )

        assert file.source() == """import { alpha, beta } from "./shared";

const value = alpha;
"""

    def test_named_imports_are_sorted(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "sorted.ts",
            """import { gamma } from "./shared";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "alpha",
            "./shared",
        )

        assert file.add_import(
            "beta",
            "./shared",
        )

        assert file.source() == (
            'import { gamma, alpha, beta } '
            'from "./shared";\n'
        )

    def test_add_named_import_new_module(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "new-module.ts",
            """import { alpha } from "./alpha";

const value = alpha;
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "beta",
            "./beta",
        )

        output = file.source()

        assert (
            'import { alpha } from "./alpha";'
            in output
        )

        assert (
            'import { beta } from "./beta";'
            in output
        )

        assert output.index(
            'from "./alpha"'
        ) < output.index(
            'from "./beta"'
        ) < output.index(
            "const value"
        )

    def test_quote_style_preserved_when_merging(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "quote-style.ts",
            """import { alpha } from "./shared";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "beta",
            "./shared",
        )

        assert (
            'from "./shared";'
            in file.source()
        )

        assert (
            "from './shared';"
            not in file.source()
        )

    def test_duplicate_named_import_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        source = (
            'import { alpha } '
            'from "./shared";\n'
        )

        path = write_typescript(
            temp_workspace,
            "duplicate.ts",
            source,
        )

        file = TypeScriptFile.load(path)

        assert (
            file.add_import(
                "alpha",
                "./shared",
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False

    def test_same_local_name_different_module_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "different-module.ts",
            """import { client } from "./first";
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Local import name",
        ):
            file.add_import(
                "client",
                "./second",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False


    def test_named_import_with_existing_default_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-existing.ts",
            """import client from "./client";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "createClient",
            "./client",
        )

        assert file.source() == (
            'import client, { createClient } '
            'from "./client";\n'
        )

    def test_named_import_with_existing_namespace_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "namespace-existing.ts",
            """import * as utils from "./utils";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "format",
            "./utils",
        )

        output = file.source()

        assert (
            'import * as utils from "./utils";'
            in output
        )

        assert (
            'import { format } from "./utils";'
            in output
        )




class TestDefaultImportAdd:
    def test_add_default_import_to_empty_file(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-empty.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
            default=True,
        )

        assert file.source() == (
            "import client from './client';\n"
        )

    def test_add_default_import_before_code(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-code.ts",
            "const value = 1;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
            default=True,
        )

        assert file.source() == """import client from './client';

const value = 1;
"""

    def test_merge_default_with_named_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-merge.ts",
            """import { createClient } from "./client";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
            default=True,
        )

        assert file.source() == (
            'import client, { createClient } '
            'from "./client";\n'
        )

    def test_duplicate_default_import_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        source = (
            'import client from "./client";\n'
        )

        path = write_typescript(
            temp_workspace,
            "default-duplicate.ts",
            source,
        )

        file = TypeScriptFile.load(path)

        assert (
            file.add_import(
                "client",
                "./client",
                default=True,
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False

    def test_conflicting_default_import_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-conflict.ts",
            """import existingClient from "./client";
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
        ):
            file.add_import(
                "client",
                "./client",
                default=True,
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_default_import_with_namespace_import(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "default-namespace.ts",
            """import * as utils from "./utils";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "utilsClient",
            "./utils",
            default=True,
        )

        assert file.source() == (
            'import utilsClient, * as utils '
            'from "./utils";\n'
        )


class TestImportAddValidation:
    @pytest.mark.parametrize(
        (
            "symbol",
            "module",
            "expected_exception",
        ),
        [
            (
                "",
                "./client",
                ValueError,
            ),
            (
                "client",
                "",
                ValueError,
            ),
            (
                123,
                "./client",
                TypeError,
            ),
            (
                "client",
                123,
                TypeError,
            ),
        ],
    )
    def test_invalid_arguments_rejected(
        self,
        temp_workspace: Path,
        symbol,
        module,
        expected_exception,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            expected_exception,
        ):
            file.add_import(
                symbol,
                module,
            )

    def test_utf16_content_preserved(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """const message = "😀测试🚀";
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
        )

        output = file.source()

        assert (
            "import { client } "
            "from './client';"
            in output
        )

        assert (
            'const message = "😀测试🚀";'
            in output
        )

    def test_named_import_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging-named.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert operation["action"] == (
            "add_import"
        )

        assert operation["symbol"] == "client"
        assert operation["module"] == "./client"
        assert operation["default"] is False

        assert (
            operation["engine"]
            == "typescript_ast"
        )

        assert isinstance(
            operation["shape"],
            str,
        )

    def test_default_import_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging-default.ts",
            "",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "client",
            "./client",
            default=True,
        )

        operation = file.operations[-1]

        assert operation["action"] == (
            "add_import"
        )

        assert operation["symbol"] == "client"
        assert operation["module"] == "./client"
        assert operation["default"] is True

        assert (
            operation["engine"]
            == "typescript_ast"
        )

    def test_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "whitespace.ts",
            """import { alpha } from "./alpha";

const value = alpha;
""",
        )

        file = TypeScriptFile.load(path)

        assert file.add_import(
            "beta",
            "./beta",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
