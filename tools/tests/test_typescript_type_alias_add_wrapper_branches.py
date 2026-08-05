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
    source: str = "const existing = 1;\n",
) -> TypeScriptFile:
    path = workspace / "type-alias-add.ts"
    path.write_text(
        source,
        encoding="utf-8",
    )
    return TypeScriptFile.load(path)


class TestAddTypeAliasValidationBranches:
    @pytest.mark.parametrize(
        (
            "type_name",
            "definition",
            "kwargs",
            "expected_exception",
        ),
        (
            (
                123,
                "string",
                {},
                TypeError,
            ),
            (
                "Status",
                123,
                {},
                TypeError,
            ),
            (
                "",
                "string",
                {},
                ValueError,
            ),
            (
                "   ",
                "string",
                {},
                ValueError,
            ),
            (
                "Status",
                "",
                {},
                ValueError,
            ),
            (
                "Status",
                "   ",
                {},
                ValueError,
            ),
            (
                "Status",
                "string",
                {
                    "type_parameters": 123,
                },
                TypeError,
            ),
            (
                "Status",
                "string",
                {
                    "type_parameters": "",
                },
                ValueError,
            ),
            (
                "Status",
                "string",
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
        type_name,
        definition,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_type_alias(
                type_name,
                definition,
                **kwargs,
            )

    def test_add_basic_type_alias(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        assert file.add_type_alias(
            "Status",
            '"pending" | "done"',
        )

        assert file.source() == (
            'type Status = "pending" | "done";'
        )

    def test_add_exported_generic_type_alias(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        assert file.add_type_alias(
            "Result",
            "{ value: T }",
            type_parameters="T",
            modifiers="export",
        )

        assert (
            "export type Result<T> = "
            "{ value: T };"
            in file.source()
        )

    def test_existing_angle_brackets_preserved(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "",
        )

        assert file.add_type_alias(
            "Result",
            "T",
            type_parameters="<T>",
        )

        assert (
            "type Result<T> = T;"
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

        add_type_alias_text = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file,
            "add_type_alias_text",
            add_type_alias_text,
        )

        assert file.add_type_alias(
            "Status",
            "string",
            before="existing",
        )

        add_type_alias_text.assert_called_once_with(
            "type Status = string;",
            before="existing",
            after=None,
            position=None,
        )


class TestAddTypeAliasTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "type_alias_text",
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
        ),
    )
    def test_invalid_text_rejected(
        self,
        temp_workspace: Path,
        type_alias_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_type_alias_text(
                type_alias_text
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
            file.add_type_alias_text(
                "type Status = string;"
            )

    @pytest.mark.parametrize(
        "diagnostic",
        (
            {
                "message": "invalid alias",
            },
            {
                "messageText": (
                    "invalid alias text"
                ),
            },
            {
                "unexpected": "diagnostic",
            },
            "plain diagnostic",
        ),
    )
    def test_diagnostics_are_wrapped(
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
            match="Could not parse type alias text",
        ):
            file.add_type_alias_text(
                "type Status = string;"
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

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="type",
                name="Status",
            ),
            SimpleNamespace(
                kind="type",
                name="Other",
            ),
        ]

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=result
            ),
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(
                return_value=navigator
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="exactly one declaration",
        ):
            file.add_type_alias_text(
                "type Status = string;"
            )

    def test_non_type_declaration_rejected(
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

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="interface",
                name="Status",
            ),
        ]

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=result
            ),
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(
                return_value=navigator
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="type alias declaration",
        ):
            file.add_type_alias_text(
                "interface Status {}"
            )

    def test_anonymous_type_alias_rejected(
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

        navigator = Mock()
        navigator.declarations.return_value = [
            SimpleNamespace(
                kind="type",
                name=None,
            ),
        ]

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=result
            ),
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(
                return_value=navigator
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Anonymous type aliases",
        ):
            file.add_type_alias_text(
                "type Status = string;"
            )

    def test_valid_text_forwards_to_add_declaration(
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

        declaration = SimpleNamespace(
            kind="type",
            name="Status",
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            declaration
        ]

        add_declaration = Mock(
            return_value=True
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=result
            ),
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(
                return_value=navigator
            ),
        )

        monkeypatch.setattr(
            file,
            "add_declaration",
            add_declaration,
        )

        assert file.add_type_alias_text(
            "type Status = string;",
            after="Existing",
        )

        add_declaration.assert_called_once_with(
            "Status",
            "type Status = string;",
            kind="type",
            before=None,
            after="Existing",
            position=None,
        )
