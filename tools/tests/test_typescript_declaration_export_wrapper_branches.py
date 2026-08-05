from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.declaration_export_modifier import (
    InvalidDeclarationExport,
)
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
    path = workspace / "declaration-export.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestExportDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "name",
            "default",
            "expected_exception",
        ),
        (
            (
                123,
                False,
                TypeError,
            ),
            (
                "",
                False,
                ValueError,
            ),
            (
                "   ",
                False,
                ValueError,
            ),
            (
                "UserService",
                1,
                TypeError,
            ),
        ),
    )
    def test_invalid_export_arguments(
        self,
        temp_workspace: Path,
        name,
        default,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.export_declaration(
                name,
                default=default,
            )

    def test_export_name_is_trimmed(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.export_declaration(
            "  UserService  "
        )

        assert (
            file.source()
            == "export class UserService {}\n"
        )

    def test_add_default_export(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.export_declaration(
            "UserService",
            default=True,
        )

        assert (
            file.source()
            == (
                "export default "
                "class UserService {}\n"
            )
        )

    def test_existing_export_is_noop(
        self,
        temp_workspace: Path,
    ) -> None:
        source = (
            "export class UserService {}\n"
        )

        file = write_typescript(
            temp_workspace,
            source,
        )

        assert (
            file.export_declaration(
                "UserService"
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False


class TestUnexportDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "name",
            "default_only",
            "expected_exception",
        ),
        (
            (
                123,
                False,
                TypeError,
            ),
            (
                "",
                False,
                ValueError,
            ),
            (
                "   ",
                False,
                ValueError,
            ),
            (
                "UserService",
                1,
                TypeError,
            ),
        ),
    )
    def test_invalid_unexport_arguments(
        self,
        temp_workspace: Path,
        name,
        default_only,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.unexport_declaration(
                name,
                default_only=default_only,
            )

    def test_remove_export(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "export class UserService {}\n",
        )

        assert file.unexport_declaration(
            "UserService"
        )

        assert (
            file.source()
            == "class UserService {}\n"
        )

    def test_remove_default_only(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                "export default "
                "class UserService {}\n"
            ),
        )

        assert file.unexport_declaration(
            "UserService",
            default_only=True,
        )

        assert (
            file.source()
            == "export class UserService {}\n"
        )

    def test_nonexported_declaration_is_noop(
        self,
        temp_workspace: Path,
    ) -> None:
        source = "class UserService {}\n"

        file = write_typescript(
            temp_workspace,
            source,
        )

        assert (
            file.unexport_declaration(
                "UserService"
            )
            is False
        )

        assert file.source() == source
        assert file.operations == []
        assert file.dirty is False


class TestModifyDeclarationExportInternalBranches:
    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.export_declaration(
                "MissingService"
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_ambiguous_declaration_is_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        first = Mock()
        first.contains_name.return_value = True

        second = Mock()
        second.contains_name.return_value = True

        navigator = Mock()
        navigator.declarations.return_value = (
            first,
            second,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="More than one declaration",
        ):
            file.export_declaration(
                "UserService"
            )

    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = True

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )

        planner = Mock()
        planner.plan.side_effect = (
            InvalidDeclarationExport(
                "invalid export request"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "DeclarationExportPlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="invalid export request",
        ):
            file.export_declaration(
                "UserService"
            )

    def test_planner_noop_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = True

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )

        planner = Mock()
        planner.plan.return_value = None

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "DeclarationExportPlanner"
            ),
            lambda: planner,
        )

        assert (
            file.export_declaration(
                "UserService"
            )
            is False
        )

    def test_editor_noop_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = True

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )

        plan = SimpleNamespace(
            edits=(
                SimpleNamespace(
                    start=0,
                    end=0,
                    text="export ",
                ),
            ),
            shape=SimpleNamespace(
                value="add_export"
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
            (
                "tools.modifier.typescript."
                "DeclarationExportPlanner"
            ),
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.export_declaration(
                "UserService"
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            0,
            "export ",
        )

        assert file.operations == []

    def test_export_operation_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.export_declaration(
            "UserService",
            default=True,
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "export_declaration"
        )
        assert (
            operation["name"]
            == "UserService"
        )
        assert operation["kind"] == "class"
        assert operation["default"] is True
        assert (
            operation["default_only"]
            is False
        )
        assert (
            operation["engine"]
            == "typescript_ast"
        )
        assert (
            operation["shape"]
            == "add_declaration_export_default"
        )
        assert file.dirty is True

    def test_unexport_operation_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                "export default "
                "class UserService {}\n"
            ),
        )

        assert file.unexport_declaration(
            "UserService",
            default_only=True,
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "unexport_declaration"
        )
        assert (
            operation["name"]
            == "UserService"
        )
        assert operation["kind"] == "class"
        assert operation["default"] is False
        assert (
            operation["default_only"]
            is True
        )
        assert (
            operation["shape"]
            == "remove_declaration_default"
        )
        assert file.dirty is True
