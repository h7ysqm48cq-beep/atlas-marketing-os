from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_source(
    workspace: Path,
    filename: str,
    source: str,
) -> Path:
    path = workspace / filename

    path.write_text(
        source,
        encoding="utf-8",
    )

    return path


def make_file(
    workspace: Path,
    filename: str = "member-core.ts",
) -> TypeScriptFile:
    path = write_source(
        workspace,
        filename,
        """class UserService {
  login(): void {}
}
""",
    )

    return TypeScriptFile.load(path)


class TestUpdateMemberArgumentValidation:
    def test_class_name_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "class-name-type.ts",
        )

        with pytest.raises(
            TypeError,
            match="class_name must be a string",
        ):
            file.update_member(
                123,
                "login",
                "login(): void {}",
            )

    def test_member_name_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "member-name-type.ts",
        )

        with pytest.raises(
            TypeError,
            match="member_name must be a string",
        ):
            file.update_member(
                "UserService",
                123,
                "login(): void {}",
            )

    def test_replacement_text_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "replacement-type.ts",
        )

        with pytest.raises(
            TypeError,
            match="replacement_text must be a string",
        ):
            file.update_member(
                "UserService",
                "login",
                123,
            )

    def test_kind_must_be_string_or_none(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "kind-type.ts",
        )

        with pytest.raises(
            TypeError,
            match="kind must be a string or None",
        ):
            file.update_member(
                "UserService",
                "login",
                "login(): void {}",
                kind=123,
            )

    def test_class_name_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "class-name-empty.ts",
        )

        with pytest.raises(
            ValueError,
            match="class_name cannot be empty",
        ):
            file.update_member(
                " ",
                "login",
                "login(): void {}",
            )

    def test_member_name_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "member-name-empty.ts",
        )

        with pytest.raises(
            ValueError,
            match="member_name cannot be empty",
        ):
            file.update_member(
                "UserService",
                " ",
                "login(): void {}",
            )

    def test_kind_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = make_file(
            temp_workspace,
            "kind-empty.ts",
        )

        with pytest.raises(
            ValueError,
            match="kind cannot be empty",
        ):
            file.update_member(
                "UserService",
                "login",
                "login(): void {}",
                kind=" ",
            )


class TestReplacementDiagnosticBranches:
    def test_non_mapping_diagnostic_is_rendered(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = make_file(
            temp_workspace,
            "diagnostic-object.ts",
        )

        original_parse_source = (
            file._bridge.parse_source
        )

        call_count = 0

        def parse_source(
            source: str,
            *,
            suffix: str = ".ts",
        ):
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                return original_parse_source(
                    source,
                    suffix=suffix,
                )

            return SimpleNamespace(
                diagnostics=[
                    "synthetic replacement error"
                ],
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            parse_source,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="synthetic replacement error",
        ):
            file.update_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )


class TestNormalizeMemberTokens:
    def test_invalid_container_type(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match=(
                "decorators must be a string, "
                "list, tuple, or None"
            ),
        ):
            TypeScriptFile._normalize_member_tokens(
                123,
                field_name="decorators",
            )

    def test_item_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match=(
                "Each modifiers item "
                "must be a string"
            ),
        ):
            TypeScriptFile._normalize_member_tokens(
                ["public", 123],
                field_name="modifiers",
            )

    def test_empty_item_rejected(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match=(
                "decorators cannot contain "
                "empty values"
            ),
        ):
            TypeScriptFile._normalize_member_tokens(
                ["Log()", " "],
                field_name="decorators",
            )

    def test_none_and_tuple_normalization(
        self,
    ) -> None:
        assert (
            TypeScriptFile
            ._normalize_member_tokens(
                None,
                field_name="modifiers",
            )
            == ()
        )

        assert (
            TypeScriptFile
            ._normalize_member_tokens(
                (" public ", " readonly "),
                field_name="modifiers",
            )
            == (
                "public",
                "readonly",
            )
        )


class TestRenderMemberPrefix:
    def test_decorator_without_at_is_prefixed(
        self,
    ) -> None:
        decorators, modifiers = (
            TypeScriptFile
            ._render_member_prefix(
                decorators=[
                    "Log()",
                    "@Trace()",
                ],
                modifiers=[
                    "public",
                    "async",
                ],
            )
        )

        assert decorators == (
            "@Log()\n@Trace()"
        )

        assert modifiers == (
            "public async"
        )

    def test_empty_prefix(
        self,
    ) -> None:
        assert (
            TypeScriptFile
            ._render_member_prefix()
            == ("", "")
        )


class TestRenderMemberBody:
    def test_none_returns_empty_string(
        self,
    ) -> None:
        assert (
            TypeScriptFile
            ._render_member_body(None)
            == ""
        )

    def test_body_must_be_string_or_none(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match=(
                "body must be a string or None"
            ),
        ):
            TypeScriptFile._render_member_body(
                123
            )

    def test_blank_body_returns_empty_string(
        self,
    ) -> None:
        assert (
            TypeScriptFile
            ._render_member_body(
                "\n   \n"
            )
            == ""
        )

    def test_multiline_body_is_indented(
        self,
    ) -> None:
        assert (
            TypeScriptFile
            ._render_member_body(
                "if (ready) {\n"
                "  run();\n"
                "}\n"
                "\n"
                "finish();"
            )
            == (
                "  if (ready) {\n"
                "    run();\n"
                "  }\n"
                "\n"
                "  finish();"
            )
        )
