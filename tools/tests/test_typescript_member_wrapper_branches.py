from __future__ import annotations

from typing import Any

import pytest

from tools.modifier.typescript import (
    TypeScriptFile,
)


def make_file(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[
    TypeScriptFile,
    list[dict[str, Any]],
]:
    file = object.__new__(
        TypeScriptFile
    )

    calls: list[dict[str, Any]] = []

    def update_member(
        class_name: str,
        member_name: str,
        replacement_text: str,
        *,
        kind: str | None = None,
    ) -> bool:
        calls.append(
            {
                "class_name": class_name,
                "member_name": member_name,
                "replacement_text": (
                    replacement_text
                ),
                "kind": kind,
            }
        )

        return True

    monkeypatch.setattr(
        file,
        "update_member",
        update_member,
    )

    return file, calls


class TestUpdateMethodBranches:
    def test_parameters_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match="parameters must be a string",
        ):
            file.update_method(
                "UserService",
                "login",
                parameters=123,
            )

    def test_return_type_must_be_string_or_none(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "return_type must be a string "
                "or None"
            ),
        ):
            file.update_method(
                "UserService",
                "login",
                return_type=123,
            )

    def test_method_name_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "method_name must be a string"
            ),
        ):
            file.update_method(
                "UserService",
                123,
            )

    def test_method_name_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "method_name cannot be empty"
            ),
        ):
            file.update_method(
                "UserService",
                " ",
            )

    def test_return_type_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "return_type cannot be empty"
            ),
        ):
            file.update_method(
                "UserService",
                "login",
                return_type=" ",
            )

    def test_empty_body_and_decorator_rendering(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, calls = make_file(
            monkeypatch
        )

        assert file.update_method(
            "UserService",
            "login",
            decorators="Log()",
        )

        assert calls == [
            {
                "class_name": "UserService",
                "member_name": "login",
                "replacement_text": (
                    "@Log()\n"
                    "login() {}"
                ),
                "kind": "method",
            }
        ]


class TestUpdatePropertyBranches:
    def test_property_name_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "property_name must be a string"
            ),
        ):
            file.update_property(
                "UserService",
                123,
            )

    def test_optional_must_be_boolean(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "optional must be a boolean"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                optional=1,
            )

    def test_definite_must_be_boolean(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "definite must be a boolean"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                definite=1,
            )

    def test_property_name_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "property_name cannot be empty"
            ),
        ):
            file.update_property(
                "UserService",
                " ",
            )

    def test_type_annotation_type(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "type_annotation must be a "
                "string or None"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                type_annotation=123,
            )

    def test_type_annotation_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "type_annotation cannot be empty"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                type_annotation=" ",
            )

    def test_initializer_type(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "initializer must be a string "
                "or None"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                initializer=123,
            )

    def test_initializer_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "initializer cannot be empty"
            ),
        ):
            file.update_property(
                "UserService",
                "active",
                initializer=" ",
            )

    def test_plain_property_rendering(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, calls = make_file(
            monkeypatch
        )

        assert file.update_property(
            "UserService",
            "active",
        )

        assert calls[0] == {
            "class_name": "UserService",
            "member_name": "active",
            "replacement_text": "active;",
            "kind": "property",
        }


class TestUpdateGetterBranches:
    def test_getter_name_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "getter_name must be a string"
            ),
        ):
            file.update_getter(
                "UserService",
                123,
            )

    def test_getter_name_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "getter_name cannot be empty"
            ),
        ):
            file.update_getter(
                "UserService",
                " ",
            )

    def test_return_type_must_be_string_or_none(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "return_type must be a string "
                "or None"
            ),
        ):
            file.update_getter(
                "UserService",
                "active",
                return_type=123,
            )

    def test_return_type_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "return_type cannot be empty"
            ),
        ):
            file.update_getter(
                "UserService",
                "active",
                return_type=" ",
            )

    def test_empty_body_with_decorator(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, calls = make_file(
            monkeypatch
        )

        assert file.update_getter(
            "UserService",
            "active",
            decorators="@Cached()",
        )

        assert calls[0] == {
            "class_name": "UserService",
            "member_name": "active",
            "replacement_text": (
                "@Cached()\n"
                "get active() {}"
            ),
            "kind": "getter",
        }


class TestUpdateSetterBranches:
    def test_setter_name_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "setter_name must be a string"
            ),
        ):
            file.update_setter(
                "UserService",
                123,
                parameter="value: boolean",
            )

    def test_parameter_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "parameter must be a string"
            ),
        ):
            file.update_setter(
                "UserService",
                "active",
                parameter=123,
            )

    def test_setter_name_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "setter_name cannot be empty"
            ),
        ):
            file.update_setter(
                "UserService",
                " ",
                parameter="value: boolean",
            )

    def test_parameter_cannot_be_empty(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            ValueError,
            match=(
                "parameter cannot be empty"
            ),
        ):
            file.update_setter(
                "UserService",
                "active",
                parameter=" ",
            )

    def test_empty_body_with_decorator(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, calls = make_file(
            monkeypatch
        )

        assert file.update_setter(
            "UserService",
            "active",
            parameter="value: boolean",
            decorators="Audit()",
        )

        assert calls[0] == {
            "class_name": "UserService",
            "member_name": "active",
            "replacement_text": (
                "@Audit()\n"
                "set active(value: boolean) {}"
            ),
            "kind": "setter",
        }


class TestUpdateConstructorBranches:
    def test_parameters_must_be_string(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, _ = make_file(monkeypatch)

        with pytest.raises(
            TypeError,
            match=(
                "parameters must be a string"
            ),
        ):
            file.update_constructor(
                "UserService",
                parameters=123,
            )

    def test_empty_body_with_decorator(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file, calls = make_file(
            monkeypatch
        )

        assert file.update_constructor(
            "UserService",
            decorators="Injectable()",
        )

        assert calls[0] == {
            "class_name": "UserService",
            "member_name": "constructor",
            "replacement_text": (
                "@Injectable()\n"
                "constructor() {}"
            ),
            "kind": "constructor",
        }
