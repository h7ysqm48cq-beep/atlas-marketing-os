from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from tools.modifier.member_add import MemberAddError

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import TypeScriptFile


def write_typescript(
    workspace: Path,
    filename: str = "member-add-wrapper.ts",
    source: str = "class UserService {}\n",
) -> TypeScriptFile:
    path = workspace / filename
    path.write_text(source, encoding="utf-8")
    return TypeScriptFile.load(path)


class TestAddMethodValidation:
    def test_parameters_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="parameters must be a string",
        ):
            file.add_method(
                "UserService",
                "login",
                parameters=123,
            )

    def test_return_type_must_be_string_or_none(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="return_type must be a string or None",
        ):
            file.add_method(
                "UserService",
                "login",
                return_type=123,
            )

    def test_return_type_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="return_type cannot be empty",
        ):
            file.add_method(
                "UserService",
                "login",
                return_type="   ",
            )

    def test_empty_body_and_decorator_branch(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.add_method(
            "UserService",
            "login",
            decorators="Log()",
        )

        output = file.source()

        assert "@Log()" in output
        assert "login() {}" in output


class TestAddPropertyValidation:
    def test_optional_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="optional must be a boolean",
        ):
            file.add_property(
                "UserService",
                "name",
                optional=1,
            )

    def test_definite_must_be_boolean(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="definite must be a boolean",
        ):
            file.add_property(
                "UserService",
                "name",
                definite=1,
            )

    def test_type_annotation_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="type_annotation must be a string or None",
        ):
            file.add_property(
                "UserService",
                "name",
                type_annotation=123,
            )

    def test_type_annotation_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="type_annotation cannot be empty",
        ):
            file.add_property(
                "UserService",
                "name",
                type_annotation=" ",
            )

    def test_initializer_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="initializer must be a string or None",
        ):
            file.add_property(
                "UserService",
                "name",
                initializer=123,
            )

    def test_initializer_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="initializer cannot be empty",
        ):
            file.add_property(
                "UserService",
                "name",
                initializer=" ",
            )

    def test_property_without_type_or_initializer(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.add_property(
            "UserService",
            "active",
        )

        assert "active;" in file.source()


class TestAccessorAndConstructorBranches:
    def test_getter_return_type_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="return_type must be a string or None",
        ):
            file.add_getter(
                "UserService",
                "active",
                return_type=123,
            )

    def test_getter_return_type_cannot_be_empty(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match="return_type cannot be empty",
        ):
            file.add_getter(
                "UserService",
                "active",
                return_type=" ",
            )

    def test_getter_empty_body_with_decorator(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.add_getter(
            "UserService",
            "active",
            decorators="Computed()",
        )

        output = file.source()

        assert "@Computed()" in output
        assert "get active() {}" in output

    def test_setter_parameter_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="parameter must be a string",
        ):
            file.add_setter(
                "UserService",
                "active",
                parameter=123,
            )

    def test_setter_empty_body_with_decorator(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.add_setter(
            "UserService",
            "active",
            parameter="value: boolean",
            decorators="Log()",
        )

        output = file.source()

        assert "@Log()" in output
        assert "set active(value: boolean) {}" in output

    def test_constructor_parameters_must_be_string(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match="parameters must be a string",
        ):
            file.add_constructor(
                "UserService",
                parameters=123,
            )

    def test_constructor_empty_body_with_decorator(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        assert file.add_constructor(
            "UserService",
            decorators="Injectable()",
        )

        output = file.source()

        assert "@Injectable()" in output
        assert "constructor() {}" in output


class TestGenericAddMemberValidation:
    @pytest.mark.parametrize(
        ("field_name", "kwargs"),
        [
            (
                "class_name",
                {
                    "class_name": 123,
                    "member_name": "login",
                    "member_text": "login(): void {}",
                    "kind": "method",
                },
            ),
            (
                "member_name",
                {
                    "class_name": "UserService",
                    "member_name": 123,
                    "member_text": "login(): void {}",
                    "kind": "method",
                },
            ),
            (
                "member_text",
                {
                    "class_name": "UserService",
                    "member_name": "login",
                    "member_text": 123,
                    "kind": "method",
                },
            ),
            (
                "kind",
                {
                    "class_name": "UserService",
                    "member_name": "login",
                    "member_text": "login(): void {}",
                    "kind": 123,
                },
            ),
        ],
    )
    def test_required_fields_must_be_strings(
        self,
        temp_workspace: Path,
        field_name: str,
        kwargs: dict,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            TypeError,
            match=rf"{field_name} must be a string",
        ):
            file.add_member(**kwargs)

    @pytest.mark.parametrize(
        ("field_name", "kwargs"),
        [
            (
                "class_name",
                {
                    "class_name": " ",
                    "member_name": "login",
                    "member_text": "login(): void {}",
                    "kind": "method",
                },
            ),
            (
                "member_name",
                {
                    "class_name": "UserService",
                    "member_name": " ",
                    "member_text": "login(): void {}",
                    "kind": "method",
                },
            ),
            (
                "kind",
                {
                    "class_name": "UserService",
                    "member_name": "login",
                    "member_text": "login(): void {}",
                    "kind": " ",
                },
            ),
        ],
    )
    def test_required_fields_cannot_be_empty(
        self,
        temp_workspace: Path,
        field_name: str,
        kwargs: dict,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            ValueError,
            match=rf"{field_name} cannot be empty",
        ):
            file.add_member(**kwargs)

    @pytest.mark.parametrize(
        "field_name",
        [
            "before",
            "after",
            "position",
        ],
    )
    def test_optional_position_fields_must_be_strings(
        self,
        temp_workspace: Path,
        field_name: str,
    ) -> None:
        file = write_typescript(temp_workspace)

        kwargs = {
            "class_name": "UserService",
            "member_name": "login",
            "member_text": "login(): void {}",
            "kind": "method",
            field_name: 123,
        }

        with pytest.raises(
            TypeError,
            match=rf"{field_name} must be a string or None",
        ):
            file.add_member(**kwargs)

    def test_whitespace_position_values_are_forwarded(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        planner = Mock()
        planner.plan.side_effect = ValueError(
            "position cannot be empty"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberAddPlanner",
            lambda: planner,
        )

        with pytest.raises(Exception):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
                before=" ",
                after=" ",
                position=" ",
            )

        context = planner.plan.call_args.args[0]

        assert context.before == ""
        assert context.after == ""
        assert context.position == ""


class TestGenericAddMemberParsingBranches:
    def test_diagnostic_dictionary_message(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = file._bridge.parse_source

        def fake_parse(
            source: str,
            *,
            suffix: str,
        ):
            if "__AtlasMemberAdd__" in source:
                return SimpleNamespace(
                    diagnostics=[
                        {
                            "message": "dictionary diagnostic",
                        }
                    ]
                )

            return original_parse(
                source,
                suffix=suffix,
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            fake_parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="dictionary diagnostic",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )

    def test_diagnostic_message_text_fallback(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = file._bridge.parse_source

        def fake_parse(
            source: str,
            *,
            suffix: str,
        ):
            if "__AtlasMemberAdd__" in source:
                return SimpleNamespace(
                    diagnostics=[
                        {
                            "messageText": (
                                "message text diagnostic"
                            ),
                        }
                    ]
                )

            return original_parse(
                source,
                suffix=suffix,
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            fake_parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="message text diagnostic",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )

    def test_non_dictionary_diagnostic(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = file._bridge.parse_source

        def fake_parse(
            source: str,
            *,
            suffix: str,
        ):
            if "__AtlasMemberAdd__" in source:
                return SimpleNamespace(
                    diagnostics=[
                        "plain diagnostic",
                    ]
                )

            return original_parse(
                source,
                suffix=suffix,
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            fake_parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="plain diagnostic",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )

    def test_unexpected_validation_exception_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        original_parse = file._bridge.parse_source

        def fake_parse(
            source: str,
            *,
            suffix: str,
        ):
            if "__AtlasMemberAdd__" in source:
                raise RuntimeError(
                    "validation crashed"
                )

            return original_parse(
                source,
                suffix=suffix,
            )

        monkeypatch.setattr(
            file._bridge,
            "parse_source",
            fake_parse,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="validation crashed",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )

    def test_member_kind_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="kind does not match",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="property",
            )

    def test_member_name_mismatch(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(temp_workspace)

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="name does not match",
        ):
            file.add_member(
                "UserService",
                "login",
                "authenticate(): void {}",
                kind="method",
            )


class TestGenericAddMemberInternalBranches:
    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        planner = Mock()
        planner.plan.side_effect = MemberAddError(
            "planner rejected member"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.MemberAddPlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected member",
        ):
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )

    def test_editor_no_change_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(temp_workspace)

        fake_editor = Mock()
        fake_editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda *args, **kwargs: fake_editor,
        )

        assert (
            file.add_member(
                "UserService",
                "login",
                "login(): void {}",
                kind="method",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False
