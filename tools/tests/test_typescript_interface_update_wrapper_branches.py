from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.interface_update import (
    InterfaceUpdateError,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "interface User {}\n",
) -> TypeScriptFile:
    path = workspace / "interface-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateInterfaceValidationBranches:
    def test_interface_name_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="interface_name must be a string",
        ):
            file.update_interface(
                123,
            )

    def test_body_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="body must be a string",
        ):
            file.update_interface(
                "User",
                body=123,
            )

    def test_interface_name_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="interface_name cannot be empty",
        ):
            file.update_interface(
                "   ",
            )

    def test_type_parameters_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="type_parameters must be",
        ):
            file.update_interface(
                "User",
                type_parameters=123,
            )

    def test_type_parameters_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="type_parameters cannot be empty",
        ):
            file.update_interface(
                "User",
                type_parameters="   ",
            )

    def test_existing_angle_brackets_preserved(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "interface User {}\n",
        )

        assert file.update_interface(
            "User",
            type_parameters="<T>",
            body="value: T;",
        )

        assert (
            "interface User<T> {" in file.source()
        )

    def test_extends_string_branch(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.update_interface(
            "User",
            extends="BaseUser",
        )

        assert (
            "interface User extends BaseUser {}"
            in file.source()
        )

    def test_multiple_extends_and_modifier(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.update_interface(
            "User",
            extends=(
                "Serializable",
                "Identifiable",
            ),
            modifiers="export",
        )

        assert (
            "export interface User extends "
            "Serializable, Identifiable {}"
            in file.source()
        )

    def test_multiline_body_rendering(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.update_interface(
            "User",
            body=(
                "id: string;\n"
                "\n"
                "name: string;"
            ),
        )

        output = file.source()

        assert "  id: string;" in output
        assert "  name: string;" in output


class TestUpdateInterfaceTextValidationBranches:
    def test_interface_name_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="interface_name must be a string",
        ):
            file.update_interface_text(
                123,
                "interface User {}",
            )

    def test_interface_text_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="interface_text must be a string",
        ):
            file.update_interface_text(
                "User",
                123,
            )

    def test_interface_name_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="interface_name cannot be empty",
        ):
            file.update_interface_text(
                "   ",
                "interface User {}",
            )

    def test_interface_text_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="interface_text cannot be empty",
        ):
            file.update_interface_text(
                "User",
                "\n\r\n",
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert (
            file.update_interface_text(
                "Missing",
                "interface Missing {}",
            )
            is False
        )

    def test_wrong_declaration_kind_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "function User(): void {}\n",
        )

        assert (
            file.update_interface_text(
                "User",
                "interface User {}",
            )
            is False
        )


class TestUpdateInterfaceTextParserBranches:
    def test_replacement_parser_exception_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = (
            file._bridge.parse_source
        )

        call_count = 0

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                return original_parse(
                    source,
                    suffix=suffix,
                )

            raise RuntimeError(
                "replacement parser failed"
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="replacement parser failed",
        ):
            file.update_interface_text(
                "User",
                "interface User {}",
            )

    @pytest.mark.parametrize(
        (
            "diagnostic",
            "expected_message",
        ),
        [
            (
                {
                    "message": "direct diagnostic",
                },
                "direct diagnostic",
            ),
            (
                {
                    "messageText": (
                        "message text diagnostic"
                    ),
                },
                "message text diagnostic",
            ),
            (
                {
                    "code": 9999,
                },
                "9999",
            ),
            (
                SimpleNamespace(
                    description="object diagnostic"
                ),
                "object diagnostic",
            ),
        ],
    )
    def test_replacement_diagnostic_branches(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
        expected_message: str,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = (
            file._bridge.parse_source
        )

        call_count = 0

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                return original_parse(
                    source,
                    suffix=suffix,
                )

            return SimpleNamespace(
                diagnostics=[diagnostic],
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=expected_message,
        ):
            file.update_interface_text(
                "User",
                "interface User {}",
            )

    def test_multiple_replacement_declarations_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        declaration = SimpleNamespace(
            kind="interface",
        )

        current_navigator = Mock()
        current_navigator.declaration.return_value = (
            declaration
        )

        replacement_navigator = Mock()
        replacement_navigator.declarations.return_value = (
            SimpleNamespace(kind="interface"),
            SimpleNamespace(kind="interface"),
        )

        navigator_factory = Mock(
            side_effect=(
                current_navigator,
                replacement_navigator,
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            navigator_factory,
        )

        file._bridge.parse_source = Mock(
            side_effect=(
                SimpleNamespace(
                    diagnostics=[],
                ),
                SimpleNamespace(
                    diagnostics=[],
                ),
            )
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="exactly one declaration",
        ):
            file.update_interface_text(
                "User",
                "interface User {}",
            )


class TestUpdateInterfaceTextInternalBranches:
    def make_internal_file(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> tuple[
        TypeScriptFile,
        SimpleNamespace,
        SimpleNamespace,
    ]:
        file = write_typescript(temp_workspace)

        declaration = SimpleNamespace(
            kind="interface",
        )

        replacement = SimpleNamespace(
            kind="interface",
        )

        current_navigator = Mock()
        current_navigator.declaration.return_value = (
            declaration
        )

        replacement_navigator = Mock()
        replacement_navigator.declarations.return_value = (
            replacement,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(
                side_effect=(
                    current_navigator,
                    replacement_navigator,
                )
            ),
        )

        file._bridge.parse_source = Mock(
            side_effect=(
                SimpleNamespace(
                    diagnostics=[],
                ),
                SimpleNamespace(
                    diagnostics=[],
                ),
            )
        )

        return (
            file,
            declaration,
            replacement,
        )

    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _, _ = self.make_internal_file(
            temp_workspace,
            monkeypatch,
        )

        planner = Mock()
        planner.plan.side_effect = (
            InterfaceUpdateError(
                "planner rejected interface"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "InterfaceUpdatePlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected interface",
        ):
            file.update_interface_text(
                "User",
                "interface User {}",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _, _ = self.make_internal_file(
            temp_workspace,
            monkeypatch,
        )

        plan = SimpleNamespace(
            edits=(
                SimpleNamespace(
                    start=0,
                    end=1,
                    text="interface User {}",
                ),
            ),
            interface_name="User",
            replacement_name="User",
        )

        planner = Mock()
        planner.plan.return_value = plan

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "InterfaceUpdatePlanner",
            lambda: planner,
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            Mock(return_value=editor),
        )

        assert (
            file.update_interface_text(
                "User",
                "interface User {}",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            1,
            "interface User {}",
        )

        assert file.operations == []
        assert file.dirty is False

    def test_successful_internal_update_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                "interface User {\n"
                "  id: string;\n"
                "}\n"
            ),
        )

        assert file.update_interface_text(
            "User",
            (
                "interface User {\n"
                "  id: string;\n"
                "  name: string;\n"
                "}"
            ),
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "update_interface"
        )
        assert (
            operation["interface_name"]
            == "User"
        )
        assert (
            operation["replacement_name"]
            == "User"
        )
        assert (
            operation["engine"]
            == "typescript_ast"
        )
        assert file.dirty is True
