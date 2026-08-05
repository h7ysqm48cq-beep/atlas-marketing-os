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
    path = workspace / "class-add-wrapper.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestAddClassValidationBranches:
    @pytest.mark.parametrize(
        (
            "class_name",
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
                "UserService",
                {
                    "body": 123,
                },
                TypeError,
            ),
            (
                "UserService",
                {
                    "extends": 123,
                },
                TypeError,
            ),
            (
                "UserService",
                {
                    "extends": "",
                },
                ValueError,
            ),
            (
                "UserService",
                {
                    "extends": "   ",
                },
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        class_name,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_class(
                class_name,
                **kwargs,
            )

    def test_add_empty_class(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService"
        )

        assert (
            "class UserService {}"
            in file.source()
        )

    def test_add_class_with_body(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService",
            body="""run(): void {
  return;
}""",
        )

        output = file.source()

        assert "class UserService {" in output
        assert "run(): void {" in output
        assert "return;" in output

    def test_add_class_with_heritage(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService",
            extends="BaseService",
            implements=[
                "OnModuleInit",
                "Disposable",
            ],
            modifiers=[
                "export",
                "default",
            ],
        )

        assert (
            "export default class UserService "
            "extends BaseService implements "
            "OnModuleInit, Disposable"
            in file.source()
        )

    def test_add_decorated_class(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService",
            decorators=[
                "Injectable()",
                "@Trace()",
            ],
            modifiers="export",
        )

        output = file.source()

        assert output.index(
            "@Injectable()"
        ) < output.index(
            "@Trace()"
        ) < output.index(
            "export class UserService"
        )

    def test_multiline_body_preserves_blank_lines(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService",
            body="""first(): void {}

second(): void {}""",
        )

        output = file.source()

        assert "first(): void {}" in output
        assert "second(): void {}" in output


class TestAddClassTextValidationBranches:
    @pytest.mark.parametrize(
        (
            "class_text",
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
    def test_invalid_class_text(
        self,
        temp_workspace: Path,
        class_text,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.add_class_text(
                class_text
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
            file.add_class_text(
                "class UserService {}"
            )

    def test_dict_diagnostic_message_used(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[
                {
                    "message": (
                        "invalid class syntax"
                    ),
                },
            ],
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(return_value=result),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="invalid class syntax",
        ):
            file.add_class_text(
                "class UserService {"
            )

    def test_dict_diagnostic_fallback_used(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[
                {
                    "code": 1001,
                },
            ],
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(return_value=result),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="1001",
        ):
            file.add_class_text(
                "class UserService {"
            )

    def test_non_dict_diagnostic_used(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        result = SimpleNamespace(
            diagnostics=[
                "plain diagnostic",
            ],
        )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(return_value=result),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="plain diagnostic",
        ):
            file.add_class_text(
                "class UserService {"
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
            file.add_class_text(
                """class UserService {}

class AdminService {}"""
            )

    def test_non_class_declaration_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="class declaration",
        ):
            file.add_class_text(
                "interface UserService {}"
            )

    def test_anonymous_class_rejected(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        declaration = SimpleNamespace(
            kind="class",
            name=None,
        )

        navigator = Mock()
        navigator.declarations.return_value = [
            declaration
        ]

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            Mock(
                return_value=SimpleNamespace(
                    diagnostics=[],
                )
            ),
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ASTNavigator",
            Mock(return_value=navigator),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="Anonymous class",
        ):
            file.add_class_text(
                "class UserService {}"
            )

    def test_valid_class_delegates_to_add_declaration(
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

        assert file.add_class_text(
            "class UserService {}",
            before="AdminService",
        )

        add_declaration.assert_called_once_with(
            "UserService",
            "class UserService {}",
            kind="class",
            before="AdminService",
            after=None,
            position=None,
        )

    def test_valid_class_forwards_position(
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

        assert file.add_class_text(
            "class UserService {}",
            position="top",
        )

        assert (
            add_declaration.call_args.kwargs[
                "position"
            ]
            == "top"
        )

    def test_duplicate_class_error_is_propagated(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class UserService {}\n",
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match=(
                "already exists"
                "|conflicting declaration"
            ),
        ):
            file.add_class_text(
                "class UserService {}"
            )


class TestAddClassLoggingBranches:
    def test_logging_and_dirty_tracking(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.add_class(
            "UserService",
            body="run(): void {}",
            position="top",
        )

        assert file.dirty is True
        assert len(file.operations) == 1

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "add_declaration"
        )

        assert (
            operation["declaration_name"]
            == "UserService"
        )

        assert operation["kind"] == "class"
        assert operation["direction"] == "top"
        assert operation["target_name"] is None

        assert (
            operation["engine"]
            == "typescript_ast"
        )

    def test_add_before_existing_declaration(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class AdminService {}\n",
        )

        assert file.add_class(
            "UserService",
            before="AdminService",
        )

        output = file.source()

        assert output.index(
            "class UserService"
        ) < output.index(
            "class AdminService"
        )

    def test_add_after_existing_declaration(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "class UserService {}\n",
        )

        assert file.add_class(
            "AdminService",
            after="UserService",
        )

        output = file.source()

        assert output.index(
            "class UserService"
        ) < output.index(
            "class AdminService"
        )
