from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "class UserService {}\n",
) -> TypeScriptFile:
    path = workspace / "tail-coverage.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddMemberTailCoverage:
    def test_planner_unsupported_import_is_reraised(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class UserService {}\n",
        )

        planner = Mock()
        planner.plan.side_effect = (
            UnsupportedTypeScriptImport(
                "member add unsupported"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberAddPlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="member add unsupported",
        ):
            file.add_member(
                class_name="UserService",
                member_name="run",
                kind="method",
                member_text="run(): void {}",
                position="bottom",
            )


class TestAddVariableTailCoverage:
    def test_definite_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        with pytest.raises(
            TypeError,
            match="definite must be a boolean",
        ):
            file.add_variable(
                "value",
                declaration_kind="let",
                definite=1,
            )

    def test_const_cannot_use_definite_assignment(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        with pytest.raises(
            ValueError,
            match="const variables cannot use",
        ):
            file.add_variable(
                "value",
                declaration_kind="const",
                definite=True,
                initializer="1",
            )

    def test_definite_assignment_name_is_rendered(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        assert file.add_variable(
            "value",
            declaration_kind="let",
            definite=True,
            type_annotation="number",
        )

        assert (
            "let value!: number;"
            in file.source()
        )

    def test_const_requires_initializer(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        with pytest.raises(
            ValueError,
            match="const variables require",
        ):
            file.add_variable(
                "value",
                declaration_kind="const",
            )


class TestAddDeclarationTailCoverage:
    @pytest.mark.parametrize(
        (
            "kwargs",
            "expected_exception",
            "message",
        ),
        (
            (
                {
                    "declaration_name": 123,
                    "declaration_text": "class UserService {}",
                    "kind": "class",
                },
                TypeError,
                "declaration_name must be a string",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": 123,
                    "kind": "class",
                },
                TypeError,
                "declaration_text must be a string",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "class UserService {}",
                    "kind": 123,
                },
                TypeError,
                "kind must be a string",
            ),
            (
                {
                    "declaration_name": "",
                    "declaration_text": "class UserService {}",
                    "kind": "class",
                },
                ValueError,
                "declaration_name cannot be empty",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "",
                    "kind": "class",
                },
                ValueError,
                "declaration_text cannot be empty",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "class UserService {}",
                    "kind": "",
                },
                ValueError,
                "kind cannot be empty",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "class UserService {}",
                    "kind": "class",
                    "before": 123,
                },
                TypeError,
                "before must be a string or None",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "class UserService {}",
                    "kind": "class",
                    "after": 123,
                },
                TypeError,
                "after must be a string or None",
            ),
            (
                {
                    "declaration_name": "UserService",
                    "declaration_text": "class UserService {}",
                    "kind": "class",
                    "position": 123,
                },
                TypeError,
                "position must be a string or None",
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        kwargs,
        expected_exception,
        message,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        with pytest.raises(
            expected_exception,
            match=message,
        ):
            file.add_declaration(
                **kwargs,
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        plan = Mock()
        plan.edits = (
            Mock(
                start=0,
                end=0,
                text="class UserService {}",
            ),
        )

        planner = Mock()
        planner.plan.return_value = plan

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.DeclarationAddPlanner",
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.add_declaration(
                declaration_name="UserService",
                declaration_text="class UserService {}",
                kind="class",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            0,
            "class UserService {}",
        )

        assert file.operations == []
        assert file.dirty is False


class TestUpdateVariableTailCoverage:
    def test_update_variable_definite_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "let value: number;\n",
        )

        with pytest.raises(
            TypeError,
            match="definite must be a boolean",
        ):
            file.update_variable(
                "value",
                declaration_kind="let",
                definite=1,
            )

    def test_update_variable_const_cannot_use_definite_assignment(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "let value: number;\n",
        )

        with pytest.raises(
            ValueError,
            match="const variables cannot use",
        ):
            file.update_variable(
                "value",
                declaration_kind="const",
                definite=True,
                initializer="1",
            )

    def test_update_variable_definite_assignment_name_is_rendered(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "let value: number;\n",
        )

        assert file.update_variable(
            "value",
            declaration_kind="let",
            definite=True,
            type_annotation="number",
        )

        assert (
            "let value!: number;"
            in file.source()
        )

    def test_update_variable_const_requires_initializer(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "let value: number;\n",
        )

        with pytest.raises(
            ValueError,
            match="const variables require",
        ):
            file.update_variable(
                "value",
                declaration_kind="const",
            )
