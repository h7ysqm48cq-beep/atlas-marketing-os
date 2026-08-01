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


class TestDeclarationRemove:
    @pytest.mark.parametrize(
        (
            "filename",
            "source",
            "name",
            "removed_text",
            "remaining_text",
        ),
        [
            (
                "class.ts",
                """class UserService {}

class AdminService {}
""",
                "UserService",
                "class UserService",
                "class AdminService",
            ),
            (
                "function.ts",
                """function run(): void {}

function finish(): void {}
""",
                "run",
                "function run",
                "function finish",
            ),
            (
                "interface.ts",
                """interface User {}

interface Account {}
""",
                "User",
                "interface User",
                "interface Account",
            ),
            (
                "type.ts",
                """type Status = string;

type Result = number;
""",
                "Status",
                "type Status",
                "type Result",
            ),
            (
                "enum.ts",
                """enum Status {
  Active,
}

enum Priority {
  High,
}
""",
                "Status",
                "enum Status",
                "enum Priority",
            ),
            (
                "variable.ts",
                """const value = 1;

const other = 2;
""",
                "value",
                "const value",
                "const other",
            ),
        ],
    )
    def test_remove_supported_declaration(
        self,
        temp_workspace: Path,
        filename: str,
        source: str,
        name: str,
        removed_text: str,
        remaining_text: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            filename,
            source,
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            name,
        )

        output = file.source()

        assert removed_text not in output
        assert remaining_text in output

    def test_remove_declaration_with_comment(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "comment.ts",
            """// User service.
@sealed
export class UserService {}

class AdminService {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "UserService",
        )

        output = file.source()

        assert "// User service." not in output
        assert "@sealed" not in output
        assert "class UserService" not in output
        assert "class AdminService" in output

    def test_referenced_declaration_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "referenced.ts",
            """class UserService {}

const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="semantic reference",
        ):
            file.remove_declaration(
                "UserService",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    def test_force_remove_referenced_declaration(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "force.ts",
            """class UserService {}

const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "UserService",
            force=True,
        )

        output = file.source()

        assert "class UserService" not in output
        assert (
            "const service = new UserService();"
            in output
        )

        operation = file.operations[-1]

        assert operation["force"] is True
        assert (
            operation["dangling_references"]
            == 1
        )

    def test_remove_middle_variable_declarator(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "middle-variable.ts",
            """const alpha = 1, beta = 2, gamma = 3;

class Finish {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "beta",
        )

        output = file.source()

        assert (
            "const alpha = 1, gamma = 3;"
            in output
        )

        assert "beta = 2" not in output
        assert "class Finish {}" in output

        assert (
            file.operations[-1]["shape"]
            == "variable_declarator"
        )

    def test_remove_first_variable_declarator(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "first-variable.ts",
            "const alpha = 1, beta = 2;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "alpha",
        )

        assert file.source() == (
            "const beta = 2;\n"
        )

    def test_remove_last_variable_declarator(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "last-variable.ts",
            "const alpha = 1, beta = 2;\n",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "beta",
        )

        assert file.source() == (
            "const alpha = 1;\n"
        )

    def test_remove_single_variable_statement(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "single-variable.ts",
            """const value = 1;

class Finish {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "value",
        )

        assert file.source() == (
            "class Finish {}\n"
        )

        assert (
            file.operations[-1]["shape"]
            == "statement"
        )

    def test_destructuring_removal_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "destructuring.ts",
            "const { value } = source;\n",
        )

        file = TypeScriptFile.load(path)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="destructuring",
        ):
            file.remove_declaration(
                "value",
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "missing.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.remove_declaration(
                "MissingService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_utf16_declaration_removal(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """const emoji = "😀";

class UserService {}

class FinishService {
  value = "结束";
}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "UserService",
        )

        output = file.source()

        assert 'const emoji = "😀";' in output
        assert "class UserService" not in output
        assert 'value = "结束";' in output

    def test_remove_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class UserService {}

class AdminService {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "UserService",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "remove_declaration"
        )

        assert (
            operation["name"]
            == "UserService"
        )

        assert (
            operation["kind"]
            == "class"
        )

        assert (
            operation["shape"]
            == "statement"
        )

        assert operation["force"] is False

        assert (
            operation["dangling_references"]
            == 0
        )

        assert (
            operation["engine"]
            == "typescript_language_service"
        )

    def test_whitespace_stability(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "whitespace.ts",
            """class Alpha {}

class Beta {}

class Gamma {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "Beta",
        )

        output = file.source()

        assert output == """class Alpha {}

class Gamma {}
"""

        assert "\n\n\n" not in output
        assert output.endswith("\n")

    def test_remove_first_declaration_without_leading_blank_line(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "first.ts",
            """class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "Alpha",
        )

        assert file.source() == (
            "class Beta {}\n"
        )

    def test_remove_last_declaration_keeps_final_newline(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "last.ts",
            """class Alpha {}

class Beta {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.remove_declaration(
            "Beta",
        )

        assert file.source() == (
            "class Alpha {}\n"
        )
