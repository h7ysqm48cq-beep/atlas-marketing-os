from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.declaration_rename import (
    DeclarationRenameError,
    InvalidDeclarationName,
)
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = (
        "class UserService {}\n\n"
        "const service = new UserService();\n"
    ),
) -> TypeScriptFile:
    path = workspace / "rename-declaration.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestRenameDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "old_name",
            "new_name",
            "expected_exception",
        ),
        (
            (
                123,
                "AccountService",
                TypeError,
            ),
            (
                "UserService",
                123,
                TypeError,
            ),
            (
                "",
                "AccountService",
                ValueError,
            ),
            (
                "   ",
                "AccountService",
                ValueError,
            ),
            (
                "UserService",
                "",
                ValueError,
            ),
            (
                "UserService",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        old_name,
        new_name,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.rename_declaration(
                old_name,
                new_name,
            )


class TestRenameDeclarationInternalBranches:
    def test_missing_symbol_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.rename_declaration(
                "MissingService",
                "AccountService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()

        planner.plan.side_effect = (
            DeclarationRenameError(
                "rename planner rejected declaration"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationRenamePlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=(
                "rename planner rejected "
                "declaration"
            ),
        ):
            file.rename_declaration(
                "UserService",
                "AccountService",
            )

    def test_invalid_name_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()

        planner.plan.side_effect = (
            InvalidDeclarationName(
                "invalid declaration identifier"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationRenamePlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="invalid declaration identifier",
        ):
            file.rename_declaration(
                "UserService",
                "AccountService",
            )

    def test_none_plan_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()
        planner.plan.return_value = None

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationRenamePlanner",
            lambda: planner,
        )

        assert (
            file.rename_declaration(
                "UserService",
                "UserService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        plan = SimpleNamespace(
            edits=(
                SimpleNamespace(
                    start=6,
                    end=17,
                    text="AccountService",
                ),
            ),
            kind="class",
        )

        planner = Mock()
        planner.plan.return_value = plan

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationRenamePlanner",
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.rename_declaration(
                "UserService",
                "AccountService",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            6,
            17,
            "AccountService",
        )

        assert file.operations == []
        assert file.dirty is False

    def test_success_records_operation(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.rename_declaration(
            "UserService",
            "AccountService",
        )

        output = file.source()

        assert "class AccountService" in output
        assert "new AccountService()" in output
        assert "UserService" not in output

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
        assert operation["occurrences"] == 2

        assert (
            operation["engine"]
            == "typescript_language_service"
        )

        assert file.dirty is True
