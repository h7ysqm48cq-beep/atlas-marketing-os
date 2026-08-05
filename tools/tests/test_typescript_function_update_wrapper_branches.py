from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.function_update import (
    FunctionUpdateError,
    FunctionUpdatePlan,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "function run(): void {}\n",
) -> TypeScriptFile:
    path = workspace / "function-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateFunctionValidationBranches:
    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            (
                {"function_name": 123},
                "function_name must be a string",
            ),
            (
                {
                    "function_name": "run",
                    "parameters": 123,
                },
                "parameters must be a string",
            ),
            (
                {
                    "function_name": "run",
                    "body": 123,
                },
                "body must be a string",
            ),
            (
                {
                    "function_name": "run",
                    "generator": "yes",
                },
                "generator must be a boolean",
            ),
        ],
    )
    def test_invalid_basic_arguments_rejected(
        self,
        temp_workspace: Path,
        kwargs,
        message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match=message,
        ):
            file.update_function(**kwargs)

    def test_empty_function_name_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="function_name cannot be empty",
        ):
            file.update_function("   ")

    def test_invalid_type_parameters_type_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match="type_parameters must be",
        ):
            file.update_function(
                "run",
                type_parameters=123,
            )

    def test_empty_type_parameters_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="type_parameters cannot be empty",
        ):
            file.update_function(
                "run",
                type_parameters="   ",
            )

    def test_invalid_return_type_type_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match="return_type must be",
        ):
            file.update_function(
                "run",
                return_type=123,
            )

    def test_empty_return_type_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="return_type cannot be empty",
        ):
            file.update_function(
                "run",
                return_type="   ",
            )

    def test_existing_angle_bracket_type_parameters(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "function run(): void {}\n",
        )

        assert file.update_function(
            "run",
            type_parameters="<T>",
            parameters="value: T",
            return_type="T",
            body="return value;",
        )

        assert (
            "function run<T>(value: T): T"
            in file.source()
        )

    def test_decorator_and_empty_body_branches(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_function(
            "run",
            decorators="Trace()",
            modifiers="export",
        )

        output = file.source()

        assert "@Trace()" in output
        assert "export function run() {}" in output


class TestUpdateFunctionTextValidationBranches:
    @pytest.mark.parametrize(
        ("function_name", "function_text", "message"),
        [
            (
                123,
                "function run() {}",
                "function_name must be a string",
            ),
            (
                "run",
                123,
                "function_text must be a string",
            ),
        ],
    )
    def test_invalid_argument_types_rejected(
        self,
        temp_workspace: Path,
        function_name,
        function_text,
        message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match=message,
        ):
            file.update_function_text(
                function_name,
                function_text,
            )

    def test_empty_function_name_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="function_name cannot be empty",
        ):
            file.update_function_text(
                "   ",
                "function run() {}",
            )

    def test_empty_function_text_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
            match="function_text cannot be empty",
        ):
            file.update_function_text(
                "run",
                "\n\r\n",
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.update_function_text(
                "missing",
                "function missing() {}",
            )
            is False
        )

    def test_non_function_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "const run = 1;\n",
        )

        assert (
            file.update_function_text(
                "run",
                "function run() {}",
            )
            is False
        )


class TestUpdateFunctionTextParsingBranches:
    def test_replacement_parse_exception_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        original_parse = (
            file._bridge.parse_source
        )

        first_result = original_parse(
            file.source(),
            suffix=file.path.suffix,
        )

        parse = Mock(
            side_effect=[
                first_result,
                RuntimeError(
                    "replacement parser failed"
                ),
            ]
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="replacement parser failed",
        ):
            file.update_function_text(
                "run",
                "function run(): void {}",
            )

    @pytest.mark.parametrize(
        ("diagnostic", "expected"),
        [
            (
                {
                    "message": "dict diagnostic",
                },
                "dict diagnostic",
            ),
            (
                {
                    "messageText": (
                        "messageText diagnostic"
                    ),
                },
                "messageText diagnostic",
            ),
            (
                {
                    "code": 1001,
                },
                "1001",
            ),
            (
                SimpleNamespace(
                    message="object diagnostic"
                ),
                "object diagnostic",
            ),
        ],
    )
    def test_replacement_diagnostics_are_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
        expected: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        original_parse = (
            file._bridge.parse_source
        )

        first_result = original_parse(
            file.source(),
            suffix=file.path.suffix,
        )

        invalid_result = SimpleNamespace(
            diagnostics=[diagnostic],
            declarations=[],
        )

        parse = Mock(
            side_effect=[
                first_result,
                invalid_result,
            ]
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=expected,
        ):
            file.update_function_text(
                "run",
                "function run(): void {}",
            )

    def test_multiple_replacement_declarations_rejected(
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
            file.update_function_text(
                "run",
                (
                    "function run(): void {}\n"
                    "function other(): void {}"
                ),
            )

    def test_replacement_kind_error_is_wrapped(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Replacement declaration",
        ):
            file.update_function_text(
                "run",
                "class run {}",
            )


class TestUpdateFunctionTextInternalBranches:
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
            FunctionUpdateError(
                "planner rejected function"
            )
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "FunctionUpdatePlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected function",
        ):
            file.update_function_text(
                "run",
                "function run(): number "
                "{ return 1; }",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()

        planner.plan.return_value = (
            FunctionUpdatePlan(
                edits=(),
                function_name="run",
                replacement_name="run",
            )
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "FunctionUpdatePlanner"
            ),
            lambda: planner,
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "BridgeEditor"
            ),
            lambda source, result: editor,
        )

        assert (
            file.update_function_text(
                "run",
                "function run(): number "
                "{ return 1; }",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False
