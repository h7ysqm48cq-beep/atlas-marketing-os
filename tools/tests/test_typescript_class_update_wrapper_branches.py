from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.class_update import (
    ClassUpdateError,
)
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "class UserService {}\n",
) -> TypeScriptFile:
    path = workspace / "class-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestUpdateClassValidationBranches:
    @pytest.mark.parametrize(
        (
            "kwargs",
            "expected_exception",
            "message",
        ),
        [
            (
                {
                    "class_name": 123,
                },
                TypeError,
                "class_name must be a string",
            ),
            (
                {
                    "class_name": "UserService",
                    "body": 123,
                },
                TypeError,
                "body must be a string",
            ),
            (
                {
                    "class_name": "   ",
                },
                ValueError,
                "class_name cannot be empty",
            ),
            (
                {
                    "class_name": "UserService",
                    "extends": 123,
                },
                TypeError,
                "extends must be a string",
            ),
            (
                {
                    "class_name": "UserService",
                    "extends": "   ",
                },
                ValueError,
                "extends cannot be empty",
            ),
        ],
    )
    def test_invalid_update_class_arguments(
        self,
        temp_workspace: Path,
        kwargs,
        expected_exception,
        message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception,
            match=message,
        ):
            file.update_class(**kwargs)


class TestUpdateClassRenderingBranches:
    def test_decorated_class_with_empty_body(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class UserService {\n"
            "  run(): void {}\n"
            "}\n",
        )

        assert file.update_class(
            "UserService",
            decorators=[
                "Injectable()",
                "@Tracked()",
            ],
            modifiers=[
                "export",
                "default",
            ],
            extends="BaseService",
            implements=[
                "OnModuleInit",
                "Disposable",
            ],
        )

        assert file.source() == (
            "@Injectable()\n"
            "@Tracked()\n"
            "export default class UserService "
            "extends BaseService implements "
            "OnModuleInit, Disposable {}\n"
        )

    def test_multiline_body_preserves_blank_lines(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.update_class(
            "UserService",
            body=(
                "first(): void {}\n"
                "\n"
                "second(): void {}"
            ),
        )

        assert (
            "class UserService {\n"
            "  first(): void {}\n"
            "\n"
            "  second(): void {}\n"
            "}"
            in file.source()
        )


class TestUpdateClassTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "class_name",
            "class_text",
            "expected_exception",
            "message",
        ),
        [
            (
                123,
                "class UserService {}",
                TypeError,
                "class_name must be a string",
            ),
            (
                "UserService",
                123,
                TypeError,
                "class_text must be a string",
            ),
            (
                "   ",
                "class UserService {}",
                ValueError,
                "class_name cannot be empty",
            ),
            (
                "UserService",
                " \n\r ",
                ValueError,
                "class_text cannot be empty",
            ),
        ],
    )
    def test_invalid_update_class_text_arguments(
        self,
        temp_workspace: Path,
        class_name,
        class_text,
        expected_exception,
        message: str,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception,
            match=message,
        ):
            file.update_class_text(
                class_name,
                class_text,
            )

    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class OtherService {}\n",
        )

        assert (
            file.update_class_text(
                "UserService",
                "class UserService {}",
            )
            is False
        )

    def test_non_class_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "function UserService(): void {}\n",
        )

        assert (
            file.update_class_text(
                "UserService",
                "class UserService {}",
            )
            is False
        )


class TestReplacementParsingBranches:
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

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            if source == (
                "class UserService {\n"
                "  run(): void {}\n"
                "}\n"
            ):
                raise RuntimeError(
                    "replacement bridge failed"
                )

            return original_parse(
                source,
                suffix=suffix,
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="replacement bridge failed",
        ):
            file.update_class_text(
                "UserService",
                (
                    "class UserService {\n"
                    "  run(): void {}\n"
                    "}"
                ),
            )

    @pytest.mark.parametrize(
        (
            "diagnostic",
            "expected_message",
        ),
        [
            (
                {
                    "message": "message field",
                },
                "message field",
            ),
            (
                {
                    "messageText": (
                        "messageText field"
                    ),
                },
                "messageText field",
            ),
            (
                {},
                r"\{\}",
            ),
            (
                "plain diagnostic",
                "plain diagnostic",
            ),
        ],
    )
    def test_replacement_diagnostic_formats(
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

        replacement_source = (
            "class UserService {\n"
            "  run(): void {}\n"
            "}\n"
        )

        def parse_source(
            source: str,
            *,
            suffix: str,
        ):
            if source == replacement_source:
                return SimpleNamespace(
                    diagnostics=[
                        diagnostic
                    ],
                )

            return original_parse(
                source,
                suffix=suffix,
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
            file.update_class_text(
                "UserService",
                replacement_source.rstrip(
                    "\n"
                ),
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
            file.update_class_text(
                "UserService",
                (
                    "class UserService {}\n"
                    "class OtherService {}"
                ),
            )


class TestUpdateClassPlannerBranches:
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
            ClassUpdateError(
                "planner rejected class"
            )
        )

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "ClassUpdatePlanner"
            ),
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected class",
        ):
            file.update_class_text(
                "UserService",
                (
                    "class UserService {\n"
                    "  run(): void {}\n"
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

        class NoChangeEditor:
            def __init__(
                self,
                source,
                result,
            ) -> None:
                self._source = source

            def replace(
                self,
                start,
                end,
                text,
            ) -> None:
                return None

            def apply(self) -> bool:
                return False

            def source(self) -> str:
                return self._source

        monkeypatch.setattr(
            (
                "tools.modifier.typescript."
                "BridgeEditor"
            ),
            NoChangeEditor,
        )

        assert (
            file.update_class_text(
                "UserService",
                (
                    "class UserService {\n"
                    "  run(): void {}\n"
                    "}"
                ),
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False
