from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.enum_update import (
    EnumUpdateError,
    InvalidEnumUpdate,
)
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = (
        "enum Status {\n"
        "  Active,\n"
        "}\n"
    ),
) -> TypeScriptFile:
    path = workspace / "enum-update.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateEnumValidationBranches:
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
                "Status",
                123,
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
                "",
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
            file.update_enum(
                enum_name,
                members,
            )

    def test_member_item_wrong_type(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            TypeError,
        ):
            file.update_enum(
                "Status",
                [
                    "Active",
                    123,
                ],
            )

    def test_empty_member_item(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            ValueError,
        ):
            file.update_enum(
                "Status",
                [
                    "Active",
                    "   ",
                ],
            )

    def test_single_string_member(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_enum(
            "Status",
            'Active = "active"',
            modifiers=[
                "export",
                "const",
            ],
        )

        assert (
            "export const enum Status"
            in file.source()
        )

        assert (
            'Active = "active",'
            in file.source()
        )

    def test_members_with_existing_commas(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_enum(
            "Status",
            [
                "Active,",
                'Done = "done",',
            ],
        )

        output = file.source()

        assert "Active," in output
        assert 'Done = "done",' in output
        assert ",," not in output


class TestUpdateEnumTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "enum_name",
            "enum_text",
            "expected_exception",
        ),
        (
            (
                123,
                "enum Status {}",
                TypeError,
            ),
            (
                "Status",
                123,
                TypeError,
            ),
            (
                "",
                "enum Status {}",
                ValueError,
            ),
            (
                "   ",
                "enum Status {}",
                ValueError,
            ),
            (
                "Status",
                "",
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
        enum_name,
        enum_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.update_enum_text(
                enum_name,
                enum_text,
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.update_enum_text(
                "Missing",
                "enum Missing {}",
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
            file.update_enum_text(
                "Status",
                "enum Status {}",
            )
            is False
        )


class TestUpdateEnumParseBranches:
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
                "replacement enum parser failed"
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="replacement enum parser failed",
        ):
            file.update_enum_text(
                "Status",
                (
                    "enum Status {\n"
                    "  Done,\n"
                    "}"
                ),
            )

    @pytest.mark.parametrize(
        (
            "diagnostic",
            "expected_message",
        ),
        (
            (
                {
                    "message": "enum diagnostic",
                },
                "enum diagnostic",
            ),
            (
                {
                    "messageText": (
                        "enum diagnostic text"
                    ),
                },
                "enum diagnostic text",
            ),
            (
                {
                    "code": 1234,
                },
                "1234",
            ),
            (
                "plain enum diagnostic",
                "plain enum diagnostic",
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
            file.update_enum_text(
                "Status",
                (
                    "enum Status {\n"
                    "  Done,\n"
                    "}"
                ),
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
            file.update_enum_text(
                "Status",
                (
                    "enum Status {}\n"
                    "enum Other {}"
                ),
            )


class TestUpdateEnumPlannerBranches:
    @pytest.mark.parametrize(
        "planner_error",
        (
            InvalidEnumUpdate(
                "invalid enum update"
            ),
            EnumUpdateError(
                "enum planner failed"
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
                "EnumUpdatePlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=str(planner_error),
        ):
            file.update_enum_text(
                "Status",
                (
                    "enum Status {\n"
                    "  Done,\n"
                    "}"
                ),
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
            file.update_enum_text(
                "Status",
                (
                    "enum Status {\n"
                    "  Done,\n"
                    "}"
                ),
            )
            is False
        )

        editor.replace.assert_called_once()
        assert file.operations == []
        assert file.dirty is False
