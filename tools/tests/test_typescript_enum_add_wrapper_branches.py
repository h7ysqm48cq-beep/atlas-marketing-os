from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
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
) -> TypeScriptFile:
    path = workspace / "enum-add-wrapper.ts"

    path.write_text(
        "const existing = true;\n",
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddEnumTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "enum_text",
            "expected_exception",
        ),
        (
            (
                123,
                TypeError,
            ),
            (
                "",
                ValueError,
            ),
            (
                "   ",
                ValueError,
            ),
            (
                "\r\n",
                ValueError,
            ),
        ),
    )
    def test_invalid_enum_text_rejected(
        self,
        temp_workspace: Path,
        enum_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_enum_text(
                enum_text
            )

    def test_parse_exception_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        file._bridge.parse_source = Mock(
            side_effect=RuntimeError(
                "bridge failed"
            )
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="bridge failed",
        ):
            file.add_enum_text(
                "enum Status { Active }"
            )

    @pytest.mark.parametrize(
        "diagnostic",
        (
            {
                "message": "message diagnostic",
            },
            {
                "messageText": (
                    "messageText diagnostic"
                ),
            },
            {
                "code": 1001,
            },
            "string diagnostic",
        ),
    )
    def test_parse_diagnostics_are_wrapped(
        self,
        temp_workspace: Path,
        diagnostic,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        file._bridge.parse_source = Mock(
            return_value=SimpleNamespace(
                diagnostics=[
                    diagnostic,
                ],
            )
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Could not parse enum text",
        ):
            file.add_enum_text(
                "enum Status { Active }"
            )

    def test_multiple_declarations_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[],
        )

        file._bridge.parse_source = Mock(
            return_value=result
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="enum",
                name="First",
            ),
            SimpleNamespace(
                kind="enum",
                name="Second",
            ),
        ]

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda value: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="exactly one declaration",
        ):
            file.add_enum_text(
                "enum First {}\n"
                "enum Second {}"
            )

    def test_non_enum_declaration_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[],
        )

        file._bridge.parse_source = Mock(
            return_value=result
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="class",
                name="Status",
            ),
        ]

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda value: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="exactly one enum declaration",
        ):
            file.add_enum_text(
                "class Status {}"
            )

    def test_anonymous_enum_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[],
        )

        file._bridge.parse_source = Mock(
            return_value=result
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="enum",
                name=None,
            ),
        ]

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda value: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Anonymous enums",
        ):
            file.add_enum_text(
                "enum Status {}"
            )

    def test_valid_enum_delegates_to_add_declaration(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[],
        )

        file._bridge.parse_source = Mock(
            return_value=result
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="enum",
                name="Status",
            ),
        ]

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda value: navigator,
        )

        add_declaration = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_declaration",
            add_declaration,
        )

        assert file.add_enum_text(
            "\nexport enum Status {\n"
            "  Active,\n"
            "}\r\n",
            before="Before",
            after="After",
            position="top",
        )

        add_declaration.assert_called_once_with(
            "Status",
            "export enum Status {\n"
            "  Active,\n"
            "}",
            kind="enum",
            before="Before",
            after="After",
            position="top",
        )


class TestAddEnumValidationBranches:
    @pytest.mark.parametrize(
        (
            "enum_name",
            "members",
            "expected_exception",
        ),
        (
            (
                123,
                ["Active"],
                TypeError,
            ),
            (
                "",
                ["Active"],
                ValueError,
            ),
            (
                "   ",
                ["Active"],
                ValueError,
            ),
            (
                "Status",
                123,
                TypeError,
            ),
            (
                "Status",
                "",
                ValueError,
            ),
            (
                "Status",
                " \n ",
                ValueError,
            ),
            (
                "Status",
                [],
                ValueError,
            ),
            (
                "Status",
                (),
                ValueError,
            ),
            (
                "Status",
                [
                    "Active",
                    123,
                ],
                TypeError,
            ),
            (
                "Status",
                [
                    "Active",
                    "",
                ],
                ValueError,
            ),
            (
                "Status",
                [
                    "Active",
                    "   ",
                ],
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments_rejected(
        self,
        temp_workspace: Path,
        enum_name,
        members,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_enum(
                enum_name,
                members,
            )

    def test_string_members_are_normalized(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_enum_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_enum_text",
            add_enum_text,
        )

        assert file.add_enum(
            " Status ",
            """
Active
Pending = "pending",

Done
""",
            before="Before",
        )

        add_enum_text.assert_called_once_with(
            'enum Status {\n'
            '  Active,\n'
            '  Pending = "pending",\n'
            '  Done,\n'
            '}',
            before="Before",
            after=None,
            position=None,
        )

    def test_list_members_and_modifiers_rendered(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_enum_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_enum_text",
            add_enum_text,
        )

        assert file.add_enum(
            "Direction",
            [
                " Up, ",
                "Down",
            ],
            modifiers=[
                "export",
                "const",
            ],
            after="Existing",
            position="bottom",
        )

        add_enum_text.assert_called_once_with(
            "export const enum Direction {\n"
            "  Up,\n"
            "  Down,\n"
            "}",
            before=None,
            after="Existing",
            position="bottom",
        )

    def test_tuple_members_without_modifiers(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_enum_text = Mock(
            return_value=False
        )

        monkeypatch.setattr(
            file,
            "add_enum_text",
            add_enum_text,
        )

        assert (
            file.add_enum(
                "Status",
                (
                    "Active",
                    "Inactive,",
                ),
            )
            is False
        )

        add_enum_text.assert_called_once_with(
            "enum Status {\n"
            "  Active,\n"
            "  Inactive,\n"
            "}",
            before=None,
            after=None,
            position=None,
        )
