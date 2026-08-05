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
    source: str = "",
) -> TypeScriptFile:
    path = workspace / "interface-add.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddInterfaceValidationBranches:
    @pytest.mark.parametrize(
        (
            "interface_name",
            "kwargs",
            "expected_exception",
        ),
        (
            (
                123,
                {},
                TypeError,
            ),
            (
                "",
                {},
                ValueError,
            ),
            (
                "   ",
                {},
                ValueError,
            ),
            (
                "User",
                {
                    "body": 123,
                },
                TypeError,
            ),
            (
                "User",
                {
                    "type_parameters": 123,
                },
                TypeError,
            ),
            (
                "User",
                {
                    "type_parameters": "",
                },
                ValueError,
            ),
            (
                "User",
                {
                    "type_parameters": "   ",
                },
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        interface_name,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_interface(
                interface_name,
                **kwargs,
            )

    @pytest.mark.parametrize(
        "extends",
        (
            123,
            [123],
            [""],
            ["   "],
        ),
    )
    def test_invalid_extends_values(
        self,
        temp_workspace: Path,
        extends,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        expected_exception = (
            TypeError
            if (
                not isinstance(
                    extends,
                    list,
                )
                or (
                    extends
                    and not isinstance(
                        extends[0],
                        str,
                    )
                )
            )
            else ValueError
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_interface(
                "User",
                extends=extends,
            )

    def test_add_basic_interface(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "User",
        )

        assert file.source().rstrip(
            "\n"
        ) == "interface User {}"

    def test_add_interface_with_body(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "User",
            body="""id: string;

name: string;""",
        )

        assert """interface User {
  id: string;

  name: string;
}""" in file.source()

    def test_add_interface_with_modifiers(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "User",
            modifiers=[
                "export",
            ],
        )

        assert (
            "export interface User {}"
            in file.source()
        )

    def test_add_generic_interface_without_brackets(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "Result",
            type_parameters="T",
            body="data: T;",
        )

        assert (
            "interface Result<T>"
            in file.source()
        )

    def test_add_generic_interface_with_brackets(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "Result",
            type_parameters="<T>",
            body="data: T;",
        )

        assert (
            "interface Result<T>"
            in file.source()
        )

    def test_add_interface_with_extends(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_interface(
            "User",
            extends=[
                "Entity",
                "Serializable",
            ],
        )

        assert (
            "interface User extends "
            "Entity, Serializable"
            in file.source()
        )

    def test_position_arguments_forwarded(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_interface_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_interface_text",
            add_interface_text,
        )

        assert file.add_interface(
            "User",
            before="Account",
            after=None,
            position=None,
        )

        add_interface_text.assert_called_once_with(
            "interface User {}",
            before="Account",
            after=None,
            position=None,
        )


class TestAddInterfaceTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "interface_text",
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
                "\n\r",
                ValueError,
            ),
        ),
    )
    def test_invalid_interface_text(
        self,
        temp_workspace: Path,
        interface_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_interface_text(
                interface_text
            )

    def test_parse_exception_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        bridge = Mock()
        bridge.parse_source.side_effect = (
            RuntimeError("bridge failed")
        )

        monkeypatch.setattr(
            file,
            "_bridge",
            bridge,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="bridge failed",
        ):
            file.add_interface_text(
                "interface User {}"
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
                "other": "fallback diagnostic",
            },
            "string diagnostic",
        ),
    )
    def test_diagnostic_shapes_are_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        bridge = Mock()

        bridge.parse_source.return_value = (
            SimpleNamespace(
                diagnostics=[
                    diagnostic,
                ],
            )
        )

        monkeypatch.setattr(
            file,
            "_bridge",
            bridge,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Could not parse interface text",
        ):
            file.add_interface_text(
                "interface User {}"
            )

    def test_multiple_declarations_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="exactly one declaration",
        ):
            file.add_interface_text(
                """interface User {}

interface Account {}"""
            )

    @pytest.mark.parametrize(
        "source",
        (
            "class User {}",
            "type User = string;",
            "enum User { Active }",
            "function User() {}",
            "const User = 1;",
        ),
    )
    def test_non_interface_declaration_rejected(
        self,
        temp_workspace: Path,
        source: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="interface declaration",
        ):
            file.add_interface_text(
                source
            )

    def test_anonymous_interface_branch(
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

        bridge = Mock()
        bridge.parse_source.return_value = (
            result
        )

        declaration = SimpleNamespace(
            kind="interface",
            name=None,
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            declaration,
        ]

        monkeypatch.setattr(
            file,
            "_bridge",
            bridge,
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "ASTNavigator",
            lambda parsed: navigator,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Anonymous interfaces",
        ):
            file.add_interface_text(
                "interface User {}"
            )

    def test_add_declaration_arguments_forwarded(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_declaration = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_declaration",
            add_declaration,
        )

        assert file.add_interface_text(
            "\ninterface User {}\r\n",
            before="Account",
            after=None,
            position=None,
        )

        add_declaration.assert_called_once_with(
            "User",
            "interface User {}",
            kind="interface",
            before="Account",
            after=None,
            position=None,
        )

    def test_duplicate_interface_is_wrapped(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "interface User {}\n",
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="already exists",
        ):
            file.add_interface_text(
                "interface User {}"
            )

    def test_add_between_declarations(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            """interface First {}

interface Third {}
""",
        )

        assert file.add_interface(
            "Second",
            before="Third",
        )

        output = file.source()

        assert (
            output.index("interface First")
            < output.index("interface Second")
            < output.index("interface Third")
        )
