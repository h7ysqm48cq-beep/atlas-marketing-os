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
    path = workspace / "function-add-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddFunctionValidationBranches:
    @pytest.mark.parametrize(
        (
            "function_name",
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
                "run",
                {
                    "parameters": 123,
                },
                TypeError,
            ),
            (
                "run",
                {
                    "body": 123,
                },
                TypeError,
            ),
            (
                "run",
                {
                    "generator": "yes",
                },
                TypeError,
            ),
            (
                "run",
                {
                    "type_parameters": 123,
                },
                TypeError,
            ),
            (
                "run",
                {
                    "type_parameters": "",
                },
                ValueError,
            ),
            (
                "run",
                {
                    "return_type": 123,
                },
                TypeError,
            ),
            (
                "run",
                {
                    "return_type": "",
                },
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        function_name,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_function(
                function_name,
                **kwargs,
            )

    def test_add_basic_function(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "run",
        )

        assert file.source() == (
            "function run() {}"
        )

    def test_add_function_with_body(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "sum",
            parameters=(
                "left: number, right: number"
            ),
            return_type="number",
            body="return left + right;",
        )

        assert (
            """function sum(left: number, right: number): number {
  return left + right;
}"""
            in file.source()
        )

    def test_type_parameters_without_brackets(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "identity",
            type_parameters="T",
            parameters="value: T",
            return_type="T",
            body="return value;",
        )

        assert (
            "function identity<T>(value: T): T"
            in file.source()
        )

    def test_type_parameters_with_brackets(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "identity",
            type_parameters="<T>",
            parameters="value: T",
            return_type="T",
            body="return value;",
        )

        assert (
            "function identity<T>(value: T): T"
            in file.source()
        )

    def test_generator_branch(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "values",
            generator=True,
            return_type=(
                "Generator<number, void, unknown>"
            ),
            body="yield 1;",
        )

        assert (
            "function* values(): "
            "Generator<number, void, unknown>"
            in file.source()
        )

    def test_decorator_and_modifier_branches(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_function(
            "run",
            decorators=[
                "Trace()",
                "@Log()",
            ],
            modifiers=[
                "export",
                "async",
            ],
            return_type="Promise<void>",
        )

        output = file.source()

        assert output.index(
            "@Trace()"
        ) < output.index(
            "@Log()"
        ) < output.index(
            "export async function run"
        )

        assert (
            "export async function run(): "
            "Promise<void> {}"
            in output
        )

    def test_position_arguments_forwarded(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        add_function_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_function_text",
            add_function_text,
        )

        assert file.add_function(
            "run",
            before="first",
            after="second",
            position="top",
        )

        add_function_text.assert_called_once_with(
            "function run() {}",
            before="first",
            after="second",
            position="top",
        )


class TestAddFunctionTextValidationBranches:
    def test_function_text_wrong_type(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match="function_text must be a string",
        ):
            file.add_function_text(
                123
            )

    @pytest.mark.parametrize(
        "value",
        (
            "",
            "   ",
            "\n\r",
        ),
    )
    def test_empty_function_text(
        self,
        temp_workspace: Path,
        value: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="function_text cannot be empty",
        ):
            file.add_function_text(
                value
            )

    def test_bridge_parse_error_wrapped(
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
            file.add_function_text(
                "function run() {}"
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
    def test_diagnostic_message_branches(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=SimpleNamespace(
                    diagnostics=[
                        diagnostic
                    ],
                )
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Could not parse function text",
        ):
            file.add_function_text(
                "function run() {}"
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
            file.add_function_text(
                "function first() {}\n"
                "function second() {}"
            )

    def test_non_function_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="function declaration",
        ):
            file.add_function_text(
                "class UserService {}"
            )

    def test_anonymous_function_branch(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = SimpleNamespace(
            kind="function",
            name=None,
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            declaration
        ]

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            lambda result: navigator,
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=SimpleNamespace(
                    diagnostics=[],
                )
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Anonymous function",
        ):
            file.add_function_text(
                "function run() {}"
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

        assert file.add_function_text(
            "function run(): void {}",
            before="first",
            after="second",
            position="bottom",
        )

        add_declaration.assert_called_once_with(
            "run",
            "function run(): void {}",
            kind="function",
            before="first",
            after="second",
            position="bottom",
        )

    def test_duplicate_function_is_wrapped(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "function run(): void {}\n",
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=(
                "already exists|"
                "conflicting declaration"
            ),
        ):
            file.add_function_text(
                "function run(): void {}"
            )
