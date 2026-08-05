from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.declaration_add import (
    DeclarationAddError,
)
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "",
) -> TypeScriptFile:
    path = workspace / "declaration-add-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "declaration_name",
            "declaration_text",
            "kind",
            "expected_exception",
        ),
        (
            (
                123,
                "class UserService {}",
                "class",
                TypeError,
            ),
            (
                "UserService",
                123,
                "class",
                TypeError,
            ),
            (
                "UserService",
                "class UserService {}",
                123,
                TypeError,
            ),
            (
                "",
                "class UserService {}",
                "class",
                ValueError,
            ),
            (
                "   ",
                "class UserService {}",
                "class",
                ValueError,
            ),
            (
                "UserService",
                "",
                "class",
                ValueError,
            ),
            (
                "UserService",
                "   ",
                "class",
                ValueError,
            ),
            (
                "UserService",
                "class UserService {}",
                "",
                ValueError,
            ),
            (
                "UserService",
                "class UserService {}",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_required_arguments(
        self,
        temp_workspace: Path,
        declaration_name,
        declaration_text,
        kind,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_declaration(
                declaration_name,
                declaration_text,
                kind=kind,
                position="top",
            )

    @pytest.mark.parametrize(
        (
            "field_name",
            "kwargs",
        ),
        (
            (
                "before",
                {
                    "before": 123,
                },
            ),
            (
                "after",
                {
                    "after": 123,
                },
            ),
            (
                "position",
                {
                    "position": 123,
                },
            ),
        ),
    )
    def test_invalid_destination_types(
        self,
        temp_workspace: Path,
        field_name: str,
        kwargs: dict[str, object],
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match=field_name,
        ):
            file.add_declaration(
                "UserService",
                "class UserService {}",
                kind="class",
                **kwargs,
            )

    def test_destination_values_are_trimmed(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()

        planner.plan.return_value = (
            SimpleNamespace(
                edits=(),
                declaration_name=(
                    "UserService"
                ),
                declaration_kind="class",
                direction=SimpleNamespace(
                    value="before"
                ),
                target_name="AdminService",
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationAddPlanner",
            Mock(return_value=planner),
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "BridgeEditor",
            Mock(return_value=editor),
        )

        assert (
            file.add_declaration(
                " UserService ",
                "class UserService {}",
                kind=" class ",
                before=" AdminService ",
            )
            is False
        )

        context = (
            planner.plan.call_args.args[0]
        )

        assert (
            context.declaration_name
            == "UserService"
        )
        assert (
            context.declaration_kind
            == "class"
        )
        assert context.before == "AdminService"
        assert context.after is None
        assert context.position is None


class TestAddDeclarationInternalBranches:
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
            DeclarationAddError(
                "planner rejected declaration"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationAddPlanner",
            Mock(return_value=planner),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=(
                "planner rejected declaration"
            ),
        ):
            file.add_declaration(
                "UserService",
                "class UserService {}",
                kind="class",
                position="top",
            )

    def test_editor_apply_false_returns_false(
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
                    start=0,
                    end=0,
                    text="",
                ),
            ),
            declaration_name="UserService",
            declaration_kind="class",
            direction=SimpleNamespace(
                value="top"
            ),
            target_name=None,
        )

        planner = Mock()
        planner.plan.return_value = plan

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationAddPlanner",
            Mock(return_value=planner),
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "BridgeEditor",
            Mock(return_value=editor),
        )

        original = file.source()

        assert (
            file.add_declaration(
                "UserService",
                "class UserService {}",
                kind="class",
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

    def test_success_updates_state_and_log(
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
                    start=0,
                    end=0,
                    text=(
                        "class UserService {}\n"
                    ),
                ),
            ),
            declaration_name="UserService",
            declaration_kind="class",
            direction=SimpleNamespace(
                value="top"
            ),
            target_name=None,
        )

        planner = Mock()
        planner.plan.return_value = plan

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationAddPlanner",
            Mock(return_value=planner),
        )

        editor = Mock()
        editor.apply.return_value = True
        editor.source.return_value = (
            "class UserService {}\n"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "BridgeEditor",
            Mock(return_value=editor),
        )

        assert file.add_declaration(
            "UserService",
            "class UserService {}",
            kind="class",
            position="top",
        )

        assert (
            file.source()
            == "class UserService {}\n"
        )

        assert file.dirty is True
        assert (
            file._ast_import_edits_active
            is True
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "add_declaration"
        )
        assert (
            operation["declaration_name"]
            == "UserService"
        )
        assert operation["kind"] == "class"
        assert operation["direction"] == "top"
        assert operation["target_name"] is None
        assert (
            operation["engine"]
            == "typescript_ast"
        )
