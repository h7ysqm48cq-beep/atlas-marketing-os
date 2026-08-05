from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from tools.modifier.typescript import TypeScriptFile


def write_typescript(
    workspace: Path,
    source: str = (
        "class UserService {\n"
        "  login(): void {}\n"
        "}\n"
    ),
) -> TypeScriptFile:
    path = workspace / "member-rename-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestRenameMemberValidationBranches:
    @pytest.mark.parametrize(
        (
            "class_name",
            "old_name",
            "new_name",
            "kind",
            "expected_message",
        ),
        [
            (
                123,
                "login",
                "authenticate",
                "method",
                "class_name must be a string",
            ),
            (
                "UserService",
                123,
                "authenticate",
                "method",
                "old_name must be a string",
            ),
            (
                "UserService",
                "login",
                123,
                "method",
                "new_name must be a string",
            ),
            (
                "UserService",
                "login",
                "authenticate",
                123,
                "kind must be a string or None",
            ),
        ],
    )
    def test_invalid_argument_types_rejected(
        self,
        temp_workspace: Path,
        class_name,
        old_name,
        new_name,
        kind,
        expected_message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match=expected_message,
        ):
            file.rename_member(
                class_name,
                old_name,
                new_name,
                kind=kind,
            )

    @pytest.mark.parametrize(
        (
            "class_name",
            "old_name",
            "expected_message",
        ),
        [
            (
                "",
                "login",
                "class_name cannot be empty",
            ),
            (
                "UserService",
                "",
                "old_name cannot be empty",
            ),
        ],
    )
    def test_empty_required_names_rejected(
        self,
        temp_workspace: Path,
        class_name: str,
        old_name: str,
        expected_message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match=expected_message,
        ):
            file.rename_member(
                class_name,
                old_name,
                "authenticate",
                kind="method",
            )


class TestRenameMemberInternalBranches:
    def test_non_ambiguous_navigator_error_propagates(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        def raise_runtime_error(
            self,
            class_name,
            member_name,
            *,
            kind=None,
            required=True,
        ):
            raise RuntimeError(
                "unexpected navigator failure"
            )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "ASTNavigator."
                "member_rename_symbol"
            ),
            raise_runtime_error,
        )

        with pytest.raises(
            RuntimeError,
            match="unexpected navigator failure",
        ):
            file.rename_member(
                "UserService",
                "login",
                "authenticate",
                kind="method",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        original = file.source()

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda *args, **kwargs: editor,
        )

        assert (
            file.rename_member(
                "UserService",
                "login",
                "authenticate",
                kind="method",
            )
            is False
        )

        assert editor.replace.called
        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False
