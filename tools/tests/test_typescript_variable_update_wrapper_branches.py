from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.variable_update import (
    InvalidVariableUpdate,
    VariableUpdateError,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "const value = 1;\n",
) -> TypeScriptFile:
    path = workspace / "variable-update.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateVariableValidationBranches:
    @pytest.mark.parametrize(
        (
            "variable_name",
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
                "value",
                {
                    "declaration_kind": 123,
                },
                TypeError,
            ),
            (
                "value",
                {
                    "declaration_kind": "",
                },
                ValueError,
            ),
            (
                "value",
                {
                    "type_annotation": 123,
                },
                TypeError,
            ),
            (
                "value",
                {
                    "type_annotation": "",
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
            file.update_variable(
                variable_name,
                **kwargs,
            )

    @pytest.mark.parametrize(
        "declaration_kind",
        (
            "const",
            "let",
        ),
    )
    def test_declaration_kind_branches(
        self,
        temp_workspace: Path,
        declaration_kind: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_variable(
            "value",
            declaration_kind=(
                declaration_kind
            ),
            type_annotation="number",
            initializer="2",
            modifiers="export",
        )

        assert (
            f"export {declaration_kind} "
            "value: number = 2;"
            in file.source()
        )

    def test_without_type_or_initializer(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_variable(
            "value",
            declaration_kind="let",
        )

        assert (
            "let value;"
            in file.source()
        )


class TestUpdateVariableTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "variable_name",
            "variable_text",
            "expected_exception",
        ),
        (
            (
                123,
                "const value = 2;",
                TypeError,
            ),
            (
                "value",
                123,
                TypeError,
            ),
            (
                "",
                "const value = 2;",
                ValueError,
            ),
            (
                "   ",
                "const value = 2;",
                ValueError,
            ),
            (
                "value",
                "",
                ValueError,
            ),
            (
                "value",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        variable_name,
        variable_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.update_variable_text(
                variable_name,
                variable_text,
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.update_variable_text(
                "missing",
                "const missing = 2;",
            )
            is False
        )

    def test_wrong_existing_kind_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "function value() {}\n",
        )

        assert (
            file.update_variable_text(
                "value",
                "const value = 2;",
            )
            is False
        )


class TestUpdateVariableParseBranches:
    def test_bridge_parse_exception_is_wrapped(
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

        calls = 0

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            nonlocal calls
            calls += 1

            if calls == 1:
                return original_parse(
                    source,
                    suffix=suffix,
                )

            raise RuntimeError(
                "replacement variable parser failed"
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=(
                "replacement variable "
                "parser failed"
            ),
        ):
            file.update_variable_text(
                "value",
                "const value = 2;",
            )

    @pytest.mark.parametrize(
        (
            "diagnostic",
            "expected_message",
        ),
        (
            (
                {
                    "message": (
                        "variable diagnostic"
                    ),
                },
                "variable diagnostic",
            ),
            (
                {
                    "messageText": (
                        "variable diagnostic text"
                    ),
                },
                "variable diagnostic text",
            ),
            (
                {
                    "code": 1234,
                },
                "1234",
            ),
            (
                "plain variable diagnostic",
                "plain variable diagnostic",
            ),
        ),
    )
    def test_diagnostic_message_branches(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        diagnostic,
        expected_message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        original_parse = (
            file._bridge.parse_source
        )

        calls = 0

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            nonlocal calls
            calls += 1

            if calls == 1:
                return original_parse(
                    source,
                    suffix=suffix,
                )

            return SimpleNamespace(
                diagnostics=[
                    diagnostic
                ],
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
            file.update_variable_text(
                "value",
                "const value = 2;",
            )

    def test_multiple_replacements_rejected(
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
            file.update_variable_text(
                "value",
                (
                    "const value = 2;\n"
                    "const other = 3;"
                ),
            )


class TestUpdateVariablePlannerBranches:
    @pytest.mark.parametrize(
        "planner_error",
        (
            InvalidVariableUpdate(
                "invalid variable update"
            ),
            VariableUpdateError(
                "variable planner failed"
            ),
        ),
    )
    def test_planner_errors_are_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
        planner_error: Exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()
        planner.plan.side_effect = (
            planner_error
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "VariableUpdatePlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=str(planner_error),
        ):
            file.update_variable_text(
                "value",
                "const value = 2;",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "BridgeEditor"
            ),
            lambda *args, **kwargs: editor,
        )

        assert (
            file.update_variable_text(
                "value",
                "const value = 2;",
            )
            is False
        )

        editor.replace.assert_called_once()
        assert file.operations == []
        assert file.dirty is False
