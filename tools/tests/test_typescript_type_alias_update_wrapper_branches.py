from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.type_alias_update import (
    InvalidTypeAliasUpdate,
    TypeAliasUpdateError,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "type Status = string;\n",
) -> TypeScriptFile:
    path = workspace / "type-alias-update.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateTypeAliasValidationBranches:
    @pytest.mark.parametrize(
        (
            "type_name",
            "definition",
            "expected_exception",
        ),
        (
            (
                123,
                "string",
                TypeError,
            ),
            (
                "Status",
                123,
                TypeError,
            ),
            (
                "",
                "string",
                ValueError,
            ),
            (
                "Status",
                "",
                ValueError,
            ),
            (
                "   ",
                "string",
                ValueError,
            ),
            (
                "Status",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_basic_arguments(
        self,
        temp_workspace: Path,
        type_name,
        definition,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.update_type_alias(
                type_name,
                definition,
            )

    def test_type_parameters_wrong_type(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
            match="type_parameters",
        ):
            file.update_type_alias(
                "Status",
                "string",
                type_parameters=123,
            )

    def test_empty_type_parameters(
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
            file.update_type_alias(
                "Status",
                "string",
                type_parameters="   ",
            )

    def test_type_parameters_already_bracketed(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "type Status = string;\n",
        )

        assert file.update_type_alias(
            "Status",
            "T | null",
            type_parameters="<T>",
            modifiers="export",
        )

        assert (
            "export type Status<T> = T | null;"
            in file.source()
        )


class TestUpdateTypeAliasTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "type_name",
            "type_alias_text",
            "expected_exception",
        ),
        (
            (
                123,
                "type Status = string;",
                TypeError,
            ),
            (
                "Status",
                123,
                TypeError,
            ),
            (
                "",
                "type Status = string;",
                ValueError,
            ),
            (
                "Status",
                "",
                ValueError,
            ),
            (
                "   ",
                "type Status = string;",
                ValueError,
            ),
            (
                "Status",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        type_name,
        type_alias_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.update_type_alias_text(
                type_name,
                type_alias_text,
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.update_type_alias_text(
                "Missing",
                "type Missing = number;",
            )
            is False
        )

    def test_wrong_existing_kind_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "interface Status {}\n",
        )

        assert (
            file.update_type_alias_text(
                "Status",
                "type Status = string;",
            )
            is False
        )


class TestUpdateTypeAliasTextParseBranches:
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
            file.update_type_alias_text(
                "Status",
                "type Status = number;",
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
                        "diagnostic message"
                    ),
                },
                "diagnostic message",
            ),
            (
                {
                    "messageText": (
                        "diagnostic text"
                    ),
                },
                "diagnostic text",
            ),
            (
                {
                    "code": 1001,
                },
                "1001",
            ),
            (
                "plain diagnostic",
                "plain diagnostic",
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
            file.update_type_alias_text(
                "Status",
                "type Status = number;",
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
            file.update_type_alias_text(
                "Status",
                (
                    "type Status = number;\n"
                    "type Other = boolean;"
                ),
            )


class TestUpdateTypeAliasPlannerBranches:
    @pytest.mark.parametrize(
        "planner_error",
        (
            InvalidTypeAliasUpdate(
                "invalid type alias update"
            ),
            TypeAliasUpdateError(
                "type alias planner failed"
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
                "TypeAliasUpdatePlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=str(planner_error),
        ):
            file.update_type_alias_text(
                "Status",
                "type Status = number;",
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
            file.update_type_alias_text(
                "Status",
                "type Status = number;",
            )
            is False
        )

        editor.replace.assert_called_once()
        assert file.operations == []
        assert file.dirty is False
