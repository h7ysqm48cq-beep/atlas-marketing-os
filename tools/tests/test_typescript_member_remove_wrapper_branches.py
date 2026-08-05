from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.member_removal import (
    MemberRemovalError,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def make_file(
    temp_workspace: Path,
) -> TypeScriptFile:
    path = temp_workspace / "member-remove-wrapper.ts"

    path.write_text(
        """class UserService {
  login(): void {}
}
""",
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestRemoveMemberValidationBranches:
    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            (
                {
                    "class_name": 123,
                    "member_name": "login",
                },
                "class_name must be a string",
            ),
            (
                {
                    "class_name": "UserService",
                    "member_name": 123,
                },
                "member_name must be a string",
            ),
            (
                {
                    "class_name": "UserService",
                    "member_name": "login",
                    "kind": 123,
                },
                "kind must be a string or None",
            ),
            (
                {
                    "class_name": "UserService",
                    "member_name": "login",
                    "force": "yes",
                },
                "force must be a boolean",
            ),
        ],
    )
    def test_invalid_argument_types(
        self,
        temp_workspace: Path,
        kwargs: dict[str, object],
        message: str,
    ) -> None:
        file = make_file(temp_workspace)

        with pytest.raises(
            TypeError,
            match=message,
        ):
            file.remove_member(**kwargs)

    @pytest.mark.parametrize(
        ("class_name", "member_name", "kind", "message"),
        [
            (
                "   ",
                "login",
                None,
                "class_name cannot be empty",
            ),
            (
                "UserService",
                "   ",
                None,
                "member_name cannot be empty",
            ),
            (
                "UserService",
                "login",
                "   ",
                "kind cannot be empty",
            ),
        ],
    )
    def test_empty_arguments(
        self,
        temp_workspace: Path,
        class_name: str,
        member_name: str,
        kind: str | None,
        message: str,
    ) -> None:
        file = make_file(temp_workspace)

        with pytest.raises(
            ValueError,
            match=message,
        ):
            file.remove_member(
                class_name,
                member_name,
                kind=kind,
            )


class TestRemoveMemberInternalBranches:
    def test_class_member_lookup_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file(temp_workspace)

        class_node = SimpleNamespace()

        navigator = Mock()
        navigator.class_.return_value = class_node
        navigator.class_member.side_effect = RuntimeError(
            "class member lookup failed"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="class member lookup failed",
        ):
            file.remove_member(
                "UserService",
                "login",
            )

    def test_member_symbol_lookup_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file(temp_workspace)

        member = SimpleNamespace(
            kind="method",
        )

        class_node = Mock()
        class_node.members.return_value = ()

        navigator = Mock()
        navigator.class_.return_value = class_node
        navigator.class_member.return_value = member
        navigator.member_rename_symbol.side_effect = (
            RuntimeError(
                "rename symbol lookup failed"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="rename symbol lookup failed",
        ):
            file.remove_member(
                "UserService",
                "login",
                kind="method",
            )

    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file(temp_workspace)

        member = SimpleNamespace(
            kind="constructor",
        )

        class_node = Mock()
        class_node.members.return_value = ()

        navigator = Mock()
        navigator.class_.return_value = class_node
        navigator.class_member.return_value = member

        planner = Mock()
        planner.plan.side_effect = MemberRemovalError(
            "planner rejected removal"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberRemovalPlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected removal",
        ):
            file.remove_member(
                "UserService",
                "constructor",
                kind="constructor",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file(temp_workspace)

        member = SimpleNamespace(
            kind="constructor",
        )

        class_node = Mock()
        class_node.members.return_value = ()

        navigator = Mock()
        navigator.class_.return_value = class_node
        navigator.class_member.return_value = member

        plan = SimpleNamespace(
            edits=(
                SimpleNamespace(
                    start=0,
                    end=1,
                    text="",
                ),
            ),
        )

        planner = Mock()
        planner.plan.return_value = plan

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberRemovalPlanner",
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.remove_member(
                "UserService",
                "constructor",
                kind="constructor",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            1,
            "",
        )

        assert file.operations == []
        assert file.dirty is False
