from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.declaration_removal import (
    DeclarationRemovalError,
    DeclarationRemovalShape,
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
    path = workspace / "declaration-remove-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestRemoveDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "name",
            "force",
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
            (
                "UserService",
                "true",
                TypeError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        name,
        force,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.remove_declaration(
                name,
                force=force,
            )


class TestRemoveDeclarationLookupBranches:
    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.remove_declaration(
                "MissingService"
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_duplicate_matches_are_rejected(
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
            file.remove_declaration(
                "UserService"
            )

    def test_navigator_declarations_error_propagates(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        navigator = Mock()
        navigator.declarations.side_effect = (
            RuntimeError(
                "declaration lookup failed"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        with pytest.raises(
            RuntimeError,
            match="declaration lookup failed",
        ):
            file.remove_declaration(
                "UserService"
            )

    def test_rename_symbol_error_propagates(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = (
            True
        )

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )
        navigator.rename_symbol.side_effect = (
            RuntimeError(
                "rename lookup failed"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        with pytest.raises(
            RuntimeError,
            match="rename lookup failed",
        ):
            file.remove_declaration(
                "UserService"
            )


class TestRemoveDeclarationPlannerBranches:
    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = (
            True
        )

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )
        navigator.rename_symbol.return_value = None

        planner = Mock()
        planner.plan.side_effect = (
            DeclarationRemovalError(
                "planner rejected removal"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "DeclarationRemovalPlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected removal",
        ):
            file.remove_declaration(
                "UserService"
            )

    def test_unexpected_planner_error_propagates(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = (
            True
        )

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )
        navigator.rename_symbol.return_value = None

        planner = Mock()
        planner.plan.side_effect = ValueError(
            "unexpected planner failure"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "DeclarationRemovalPlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            ValueError,
            match="unexpected planner failure",
        ):
            file.remove_declaration(
                "UserService"
            )


class TestRemoveDeclarationEditorBranches:
    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = (
            True
        )
        declaration.kind = "class"

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )
        navigator.rename_symbol.return_value = None

        edit = SimpleNamespace(
            start=0,
            end=0,
            text="",
        )

        plan = SimpleNamespace(
            edits=(edit,),
            shape=(
                DeclarationRemovalShape.STATEMENT
            ),
            reference_count=0,
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
                "DeclarationRemovalPlanner"
            ),
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.remove_declaration(
                "UserService"
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            0,
            "",
        )

        assert file.operations == []
        assert file.dirty is False

    def test_success_records_operation(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = Mock()
        declaration.contains_name.return_value = (
            True
        )
        declaration.kind = "class"

        symbol = Mock()

        navigator = Mock()
        navigator.declarations.return_value = (
            declaration,
        )
        navigator.rename_symbol.return_value = symbol

        edit = SimpleNamespace(
            start=0,
            end=20,
            text="",
        )

        plan = SimpleNamespace(
            edits=(edit,),
            shape=(
                DeclarationRemovalShape.STATEMENT
            ),
            reference_count=2,
        )

        planner = Mock()
        planner.plan.return_value = plan

        editor = Mock()
        editor.apply.return_value = True
        editor.source.return_value = ""

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "DeclarationRemovalPlanner"
            ),
            lambda: planner,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert file.remove_declaration(
            "UserService",
            force=True,
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "remove_declaration"
        )
        assert (
            operation["name"]
            == "UserService"
        )
        assert operation["kind"] == "class"
        assert operation["shape"] == "statement"
        assert operation["force"] is True

        assert (
            operation["dangling_references"]
            == 2
        )

        assert (
            operation["engine"]
            == "typescript_language_service"
        )

        assert (
            file._ast_import_edits_active
            is True
        )
        assert file.dirty is True

        planner.plan.assert_called_once()

        context = (
            planner.plan.call_args.args[0]
        )

        assert context.name == "UserService"
        assert context.force is True
        assert context.symbol is symbol
        assert context.declaration is declaration


class TestRemoveDeclarationParsingBranches:
    def test_parse_error_propagates(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        file._bridge.parse_source = Mock(
            side_effect=RuntimeError(
                "source parse failed"
            )
        )

        with pytest.raises(
            RuntimeError,
            match="source parse failed",
        ):
            file.remove_declaration(
                "UserService"
            )
