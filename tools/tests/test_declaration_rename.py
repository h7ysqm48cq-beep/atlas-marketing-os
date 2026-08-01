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


class TestDeclarationRename:
    @pytest.mark.parametrize(
        (
            "filename",
            "source",
            "old_name",
            "new_name",
            "expected_text",
        ),
        [
            (
                "class.ts",
                """class UserService {}

const service = new UserService();
""",
                "UserService",
                "AccountService",
                "class AccountService {}",
            ),
            (
                "function.ts",
                """function calculate(): number {
  return 1;
}

const result = calculate();
""",
                "calculate",
                "total",
                "function total(): number",
            ),
            (
                "interface.ts",
                """interface User {
  id: string;
}

const user: User = {
  id: "1",
};
""",
                "User",
                "Account",
                "interface Account",
            ),
            (
                "type.ts",
                """type Status = "active";

const state: Status = "active";
""",
                "Status",
                "State",
                'type State = "active";',
            ),
            (
                "enum.ts",
                """enum Status {
  Active,
}

const status = Status.Active;
""",
                "Status",
                "State",
                "enum State",
            ),
            (
                "variable.ts",
                """const value = 1;

const doubled = value * 2;
""",
                "value",
                "count",
                "const count = 1;",
            ),
        ],
    )
    def test_rename_supported_declaration(
        self,
        temp_workspace: Path,
        filename: str,
        source: str,
        old_name: str,
        new_name: str,
        expected_text: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            filename,
            source,
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            old_name,
            new_name,
        )

        output = file.source()

        assert expected_text in output
        assert old_name not in output

    def test_rename_all_semantic_references(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "references.ts",
            """export class UserService {
  create(): UserService {
    return new UserService();
  }
}

const service: UserService =
  new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert output.count(
            "AccountService"
        ) == 5

        assert "UserService" not in output

    def test_string_literals_and_comments_not_renamed(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "non-semantic.ts",
            """// UserService should stay in this comment.
class UserService {}

const label = "UserService";
const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert (
            "// UserService should stay "
            "in this comment."
            in output
        )

        assert (
            'const label = "UserService";'
            in output
        )

        assert "class AccountService" in output
        assert "new AccountService()" in output

    def test_same_name_symbol_isolated(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "isolation.ts",
            """class UserService {}

class Container {
  UserService(): string {
    return "member";
  }
}

const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert "class AccountService" in output
        assert "new AccountService()" in output

        assert (
            "UserService(): string"
            in output
        )

    def test_duplicate_name_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "conflict.ts",
            """class UserService {}

class AccountService {}
""",
        )

        file = TypeScriptFile.load(path)
        original = file.source()

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already exists",
        ):
            file.rename_declaration(
                "UserService",
                "AccountService",
            )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False

    @pytest.mark.parametrize(
        "new_name",
        [
            "",
            "123User",
            "user-service",
            "User Service",
            "class",
        ],
    )
    def test_invalid_identifier_rejected(
        self,
        temp_workspace: Path,
        new_name: str,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "invalid-name.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        expected_exception = (
            ValueError
            if new_name == ""
            else UnsupportedTypeScriptImport
        )

        with pytest.raises(
            expected_exception,
        ):
            file.rename_declaration(
                "UserService",
                new_name,
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
            file.rename_declaration(
                "MissingService",
                "AccountService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_noop_rename_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "noop.ts",
            "class UserService {}\n",
        )

        file = TypeScriptFile.load(path)

        assert (
            file.rename_declaration(
                "UserService",
                "UserService",
            )
            is False
        )

        assert file.source() == (
            "class UserService {}\n"
        )

        assert file.operations == []
        assert file.dirty is False

    def test_rename_destructured_binding(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "destructuring.ts",
            """const {
  value,
} = source;

console.log(value);
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "value",
            "count",
        )

        output = file.source()

        assert "value" not in output
        assert "count" in output

    def test_rename_one_multi_variable_declarator(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "multi-variable.ts",
            """const alpha = 1, beta = alpha + 1;

console.log(beta);
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "beta",
            "gamma",
        )

        output = file.source()

        assert (
            "const alpha = 1, "
            "gamma = alpha + 1;"
            in output
        )

        assert "console.log(gamma);" in output

    def test_utf16_declaration_rename(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "utf16.ts",
            """const emoji = "😀";

class UserService {
  message = "测试🚀";
}

const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert 'const emoji = "😀";' in output
        assert 'message = "测试🚀";' in output
        assert "class AccountService" in output
        assert "new AccountService()" in output

    def test_rename_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        path = write_typescript(
            temp_workspace,
            "logging.ts",
            """class UserService {}

const service = new UserService();
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "rename_declaration"
        )

        assert (
            operation["old_name"]
            == "UserService"
        )

        assert (
            operation["new_name"]
            == "AccountService"
        )

        assert operation["kind"] == "class"

        assert (
            operation["occurrences"]
            == 2
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
            """class UserService {}

class AdminService {}
""",
        )

        file = TypeScriptFile.load(path)

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert "\n\n\n" not in output
        assert output.endswith("\n")
