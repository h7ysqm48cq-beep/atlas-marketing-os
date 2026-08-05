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
    source: str = "function run(): void {}\n",
) -> TypeScriptFile:
    path = workspace / "variable-add-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddVariableValidationBranches:
    @pytest.mark.parametrize(
        (
            "variable_name",
            "kwargs",
            "expected_exception",
        ),
        (
            (
                123,
                {"initializer": "1"},
                TypeError,
            ),
            (
                "",
                {"initializer": "1"},
                ValueError,
            ),
            (
                "   ",
                {"initializer": "1"},
                ValueError,
            ),
            (
                "value",
                {
                    "declaration_kind": 123,
                    "initializer": "1",
                },
                TypeError,
            ),
            (
                "value",
                {
                    "declaration_kind": "",
                    "initializer": "1",
                },
                ValueError,
            ),
            (
                "value",
                {
                    "declaration_kind": "using",
                    "initializer": "1",
                },
                ValueError,
            ),
            (
                "value",
                {
                    "definite": "yes",
                    "initializer": "1",
                },
                TypeError,
            ),
            (
                "value",
                {
                    "declaration_kind": "const",
                    "definite": True,
                    "initializer": "1",
                },
                ValueError,
            ),
            (
                "value",
                {
                    "type_annotation": 123,
                    "initializer": "1",
                },
                TypeError,
            ),
            (
                "value",
                {
                    "type_annotation": "",
                    "initializer": "1",
                },
                ValueError,
            ),
            (
                "value",
                {
                    "initializer": 123,
                },
                TypeError,
            ),
            (
                "value",
                {
                    "initializer": "",
                },
                ValueError,
            ),
            (
                "value",
                {},
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        variable_name,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_variable(
                variable_name,
                **kwargs,
            )

    def test_add_const_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable(
            "value",
            initializer="1",
        )

        assert (
            "const value = 1;"
            in file.source()
        )

    def test_add_let_typed_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable(
            "value",
            declaration_kind="let",
            type_annotation="number",
        )

        assert (
            "let value: number;"
            in file.source()
        )

    def test_add_var_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable(
            "value",
            declaration_kind="var",
            initializer="1",
        )

        assert (
            "var value = 1;"
            in file.source()
        )

    def test_add_definite_let_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable(
            "client",
            declaration_kind="let",
            type_annotation="ApiClient",
            definite=True,
        )

        assert (
            "let client!: ApiClient;"
            in file.source()
        )

    def test_add_modified_variable(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable(
            "value",
            initializer="1",
            modifiers=[
                "export",
                "declare",
            ],
        )

        assert (
            "export declare const value = 1;"
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

        add_variable_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_variable_text",
            add_variable_text,
        )

        assert file.add_variable(
            "value",
            initializer="1",
            before="run",
            after=None,
            position=None,
        )

        add_variable_text.assert_called_once_with(
            "const value = 1;",
            before="run",
            after=None,
            position=None,
        )


class TestAddVariableTextValidationBranches:
    @pytest.mark.parametrize(
        "variable_text",
        (
            123,
            None,
        ),
    )
    def test_non_string_rejected(
        self,
        temp_workspace: Path,
        variable_text,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(TypeError):
            file.add_variable_text(
                variable_text
            )

    @pytest.mark.parametrize(
        "variable_text",
        (
            "",
            "   ",
            "\n\r",
        ),
    )
    def test_empty_text_rejected(
        self,
        temp_workspace: Path,
        variable_text: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(ValueError):
            file.add_variable_text(
                variable_text
            )

    def test_parse_exception_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                side_effect=RuntimeError(
                    "bridge failed"
                )
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="bridge failed",
        ):
            file.add_variable_text(
                "const value = 1;"
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
    def test_diagnostic_messages_are_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[diagnostic],
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=result
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Could not parse variable text",
        ):
            file.add_variable_text(
                "const value = 1;"
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
            file.add_variable_text(
                "const first = 1;\n"
                "const second = 2;"
            )

    def test_non_variable_declaration_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="one variable statement",
        ):
            file.add_variable_text(
                "function value(): void {}"
            )

    def test_multiple_declarators_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="one variable declarator",
        ):
            file.add_variable_text(
                "const first = 1, second = 2;"
            )

    @pytest.mark.parametrize(
        "variable_text",
        (
            "const { value } = source;",
            "const [value] = source;",
        ),
    )
    def test_destructuring_rejected(
        self,
        temp_workspace: Path,
        variable_text: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Destructuring",
        ):
            file.add_variable_text(
                variable_text
            )

    def test_add_variable_text_success(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_variable_text(
            "const value = 1;",
            position="top",
        )

        assert file.source().startswith(
            "const value = 1;"
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "add_declaration"
        )

        assert (
            operation["declaration_name"]
            == "value"
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

        assert file.add_variable_text(
            "let value: number;",
            before="run",
            after=None,
            position=None,
        )

        add_declaration.assert_called_once_with(
            "value",
            "let value: number;",
            kind="variable",
            before="run",
            after=None,
            position=None,
        )
