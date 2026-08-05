from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.typescript import (
    TypeScriptFile,
)


def make_file() -> TypeScriptFile:
    file = TypeScriptFile(
        path=Path("sample.ts"),
        text=(
            "class UserService {\n"
            "  first(): void {}\n\n"
            "  second(): void {}\n"
            "}\n"
        ),
        imports=[],
        body="",
    )

    return file


class TestMoveMemberArgumentValidation:
    @pytest.mark.parametrize(
        (
            "args",
            "kwargs",
            "expected_message",
        ),
        [
            (
                (123, "first"),
                {"position": "top"},
                "class_name must be a string",
            ),
            (
                ("UserService", 123),
                {"position": "top"},
                "member_name must be a string",
            ),
            (
                ("   ", "first"),
                {"position": "top"},
                "class_name cannot be empty",
            ),
            (
                ("UserService", "   "),
                {"position": "top"},
                "member_name cannot be empty",
            ),
            (
                ("UserService", "first"),
                {
                    "kind": 123,
                    "position": "top",
                },
                "kind must be a string or None",
            ),
            (
                ("UserService", "first"),
                {"before": 123},
                "before must be a string or None",
            ),
            (
                ("UserService", "first"),
                {"after": 123},
                "after must be a string or None",
            ),
            (
                ("UserService", "first"),
                {"position": 123},
                "position must be a string or None",
            ),
        ],
    )
    def test_invalid_arguments_rejected(
        self,
        args,
        kwargs,
        expected_message: str,
    ) -> None:
        file = make_file()

        with pytest.raises(
            (TypeError, ValueError),
            match=expected_message,
        ):
            file.move_member(
                *args,
                **kwargs,
            )


class TestMoveMemberInternalBranches:
    def test_unexpected_member_lookup_error_propagates(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file()

        class_node = Mock()
        class_node.member.side_effect = RuntimeError(
            "unexpected lookup failure"
        )

        navigator = Mock()
        navigator.class_.return_value = class_node

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        file._bridge = Mock()
        file._bridge.parse_source.return_value = (
            SimpleNamespace()
        )

        with pytest.raises(
            RuntimeError,
            match="unexpected lookup failure",
        ):
            file.move_member(
                "UserService",
                "first",
                position="top",
            )

    def test_editor_no_change_returns_false(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file()

        member = SimpleNamespace(
            name="second",
            kind="method",
        )

        class_node = Mock()
        class_node.member.return_value = member
        class_node.members.return_value = (
            member,
        )

        navigator = Mock()
        navigator.class_.return_value = class_node

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        file._bridge = Mock()
        file._bridge.parse_source.return_value = (
            SimpleNamespace()
        )

        plan = SimpleNamespace(
            edits=(
                SimpleNamespace(
                    start=0,
                    end=0,
                    text="",
                ),
            ),
            source_kind="method",
            direction=SimpleNamespace(
                value="top"
            ),
            target_name=None,
            comment_attached=False,
        )

        planner = Mock()
        planner.plan.return_value = plan

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberMovePlanner",
            lambda: planner,
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        original = file.source()

        assert (
            file.move_member(
                "UserService",
                "second",
                position="top",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            0,
            "",
        )

        assert file.source() == original
        assert file.operations == []
        assert file.dirty is False
