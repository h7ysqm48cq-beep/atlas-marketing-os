from __future__ import annotations

import pytest

from tools.modifier.ast_navigator import (
    ASTNodeAmbiguous,
    ASTNodeNotFound,
    ClassMemberNode,
    ClassNode,
    InvalidASTStructure,
    MemberRenameSymbolNode,
)


def occurrence(
    *,
    start: int = 10,
    end: int = 15,
) -> dict:
    return {
        "start": start,
        "end": end,
        "prefixText": "",
        "suffixText": "",
    }


def member_rename_raw(**updates) -> dict:
    raw = {
        "className": "UserService",
        "name": "run",
        "kind": "method",
        "declarationStart": 0,
        "declarationEnd": 80,
        "memberStart": 20,
        "memberEnd": 60,
        "identifierStart": 25,
        "identifierEnd": 28,
        "occurrences": [
            occurrence(),
        ],
    }
    raw.update(updates)
    return raw


class TestMemberRenameSymbolNode:
    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
            "message",
            "value",
        ),
        (
            (
                "className",
                "class_name",
                "className",
                "",
            ),
            (
                "className",
                "class_name",
                "className",
                123,
            ),
            (
                "name",
                "name",
                "symbol name",
                "",
            ),
            (
                "name",
                "name",
                "symbol name",
                123,
            ),
        ),
    )
    def test_invalid_names(
        self,
        field: str,
        property_name: str,
        message: str,
        value,
    ) -> None:
        node = MemberRenameSymbolNode(
            member_rename_raw(
                **{
                    field: value,
                }
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match=message,
        ):
            getattr(node, property_name)

    @pytest.mark.parametrize(
        "kind",
        (
            "constructor",
            "unknown",
            "",
            None,
        ),
    )
    def test_invalid_kind(
        self,
        kind,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="kind must be",
        ):
            _ = MemberRenameSymbolNode(
                member_rename_raw(
                    kind=kind,
                )
            ).kind

    @pytest.mark.parametrize(
        "kind",
        (
            "method",
            "property",
            "getter",
            "setter",
        ),
    )
    def test_supported_kinds(
        self,
        kind: str,
    ) -> None:
        assert (
            MemberRenameSymbolNode(
                member_rename_raw(
                    kind=kind,
                )
            ).kind
            == kind
        )

    def test_all_properties(self) -> None:
        node = MemberRenameSymbolNode(
            member_rename_raw()
        )

        assert node.class_name == "UserService"
        assert node.name == "run"
        assert node.kind == "method"
        assert node.declaration_start == 0
        assert node.declaration_end == 80
        assert node.member_start == 20
        assert node.member_end == 60
        assert node.identifier_start == 25
        assert node.identifier_end == 28
        assert len(node.occurrences) == 1
        assert node.occurrences[0].start == 10

    def test_invalid_occurrences(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="member rename symbol occurrences",
        ):
            _ = MemberRenameSymbolNode(
                member_rename_raw(
                    occurrences="invalid",
                )
            ).occurrences


def parameter_raw(
    *,
    name: str = "value",
) -> dict:
    return {
        "name": name,
        "type": "string",
        "start": 30,
        "end": 45,
        "modifiers": [],
        "decorators": [],
    }


def class_member_raw(**updates) -> dict:
    raw = {
        "kind": "method",
        "name": "run",
        "start": 20,
        "end": 80,
        "memberStart": 18,
        "memberEnd": 82,
        "removalStart": 16,
        "removalEnd": 84,
        "identifierStart": 25,
        "identifierEnd": 28,
        "visibility": "public",
        "static": False,
        "async": False,
        "abstract": False,
        "readonly": False,
        "declare": False,
        "override": False,
        "optional": False,
        "computed": False,
        "modifiers": [
            "public",
        ],
        "decorators": [
            "@Injectable()",
        ],
        "parameters": [
            parameter_raw(),
        ],
        "parameterCount": 1,
        "returnType": "void",
        "type": None,
        "initializer": None,
        "bodyStart": 50,
        "bodyEnd": 79,
    }
    raw.update(updates)
    return raw


class TestClassMemberNode:
    @pytest.mark.parametrize(
        "kind",
        (
            "unknown",
            "",
            None,
        ),
    )
    def test_invalid_kind(
        self,
        kind,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="Class member kind",
        ):
            _ = ClassMemberNode(
                class_member_raw(
                    kind=kind,
                )
            ).kind

    @pytest.mark.parametrize(
        "kind",
        (
            "constructor",
            "method",
            "property",
            "getter",
            "setter",
        ),
    )
    def test_supported_kind(
        self,
        kind: str,
    ) -> None:
        assert (
            ClassMemberNode(
                class_member_raw(
                    kind=kind,
                )
            ).kind
            == kind
        )

    @pytest.mark.parametrize(
        "name",
        (
            "",
            None,
            123,
        ),
    )
    def test_invalid_name(
        self,
        name,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="Class member name",
        ):
            _ = ClassMemberNode(
                class_member_raw(
                    name=name,
                )
            ).name

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            (
                "identifierStart",
                "identifier_start",
            ),
            (
                "identifierEnd",
                "identifier_end",
            ),
        ),
    )
    def test_optional_identifier_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassMemberNode(
                class_member_raw(
                    **{
                        field: None,
                    }
                )
            ),
            property_name,
        ) is None

        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassMemberNode(
                    class_member_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    @pytest.mark.parametrize(
        "visibility",
        (
            "internal",
            "",
            None,
        ),
    )
    def test_invalid_visibility(
        self,
        visibility,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="visibility",
        ):
            _ = ClassMemberNode(
                class_member_raw(
                    visibility=visibility,
                )
            ).visibility

    @pytest.mark.parametrize(
        "visibility",
        (
            "public",
            "protected",
            "private",
        ),
    )
    def test_supported_visibility(
        self,
        visibility: str,
    ) -> None:
        assert (
            ClassMemberNode(
                class_member_raw(
                    visibility=visibility,
                )
            ).visibility
            == visibility
        )

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            ("static", "static"),
            ("async", "async_"),
            ("abstract", "abstract"),
            ("readonly", "readonly"),
            ("declare", "declare"),
            ("override", "override"),
            ("optional", "optional"),
            ("computed", "computed"),
        ),
    )
    def test_boolean_properties(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassMemberNode(
                class_member_raw(
                    **{
                        field: True,
                    }
                )
            ),
            property_name,
        ) is True

        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassMemberNode(
                    class_member_raw(
                        **{
                            field: "yes",
                        }
                    )
                ),
                property_name,
            )

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            ("modifiers", "modifiers"),
            ("decorators", "decorators"),
        ),
    )
    def test_none_sequences(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassMemberNode(
                class_member_raw(
                    **{
                        field: None,
                    }
                )
            ),
            property_name,
        ) == ()

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
            "value",
        ),
        (
            (
                "modifiers",
                "modifiers",
                "public",
            ),
            (
                "modifiers",
                "modifiers",
                123,
            ),
            (
                "modifiers",
                "modifiers",
                [
                    "public",
                    123,
                ],
            ),
            (
                "decorators",
                "decorators",
                "@Inject()",
            ),
            (
                "decorators",
                "decorators",
                123,
            ),
            (
                "decorators",
                "decorators",
                [
                    "@Inject()",
                    123,
                ],
            ),
        ),
    )
    def test_invalid_sequences(
        self,
        field: str,
        property_name: str,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassMemberNode(
                    class_member_raw(
                        **{
                            field: value,
                        }
                    )
                ),
                property_name,
            )

    def test_invalid_parameters(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="class_member.parameters",
        ):
            _ = ClassMemberNode(
                class_member_raw(
                    parameters="invalid",
                )
            ).parameters

    @pytest.mark.parametrize(
        "value",
        (
            True,
            -1,
            "1",
        ),
    )
    def test_invalid_parameter_count(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="parameterCount",
        ):
            _ = ClassMemberNode(
                class_member_raw(
                    parameterCount=value,
                )
            ).parameter_count

    def test_default_parameter_count(self) -> None:
        raw = class_member_raw()
        raw.pop("parameterCount")

        assert ClassMemberNode(
            raw
        ).parameter_count == 1

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            ("returnType", "return_type"),
            ("type", "type"),
            ("initializer", "initializer"),
        ),
    )
    def test_nullable_string_fields(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassMemberNode(
                class_member_raw(
                    **{
                        field: None,
                    }
                )
            ),
            property_name,
        ) is None

        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassMemberNode(
                    class_member_raw(
                        **{
                            field: 123,
                        }
                    )
                ),
                property_name,
            )

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            ("bodyStart", "body_start"),
            ("bodyEnd", "body_end"),
        ),
    )
    def test_optional_body_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassMemberNode(
                class_member_raw(
                    **{
                        field: None,
                    }
                )
            ),
            property_name,
        ) is None

        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassMemberNode(
                    class_member_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    def test_all_properties(self) -> None:
        node = ClassMemberNode(
            class_member_raw()
        )

        assert node.kind == "method"
        assert node.name == "run"
        assert node.start == 20
        assert node.end == 80
        assert node.member_start == 18
        assert node.member_end == 82
        assert node.removal_start == 16
        assert node.removal_end == 84
        assert node.identifier_start == 25
        assert node.identifier_end == 28
        assert node.visibility == "public"
        assert node.modifiers == ("public",)
        assert node.decorators == (
            "@Injectable()",
        )
        assert len(node.parameters) == 1
        assert node.parameter_count == 1
        assert node.return_type == "void"
        assert node.type is None
        assert node.initializer is None
        assert node.body_start == 50
        assert node.body_end == 79


def constructor_raw(
    *,
    start: int = 10,
    end: int = 40,
) -> dict:
    return {
        "start": start,
        "end": end,
        "bodyStart": 30,
        "bodyEnd": 39,
        "parameters": [],
    }


def class_raw(**updates) -> dict:
    raw = {
        "name": "UserService",
        "start": 0,
        "end": 200,
        "classStart": 0,
        "classEnd": 200,
        "identifierStart": 6,
        "identifierEnd": 17,
        "memberCount": 2,
        "members": [
            class_member_raw(
                kind="method",
                name="run",
            ),
            class_member_raw(
                kind="property",
                name="value",
                start=90,
                end=120,
                memberStart=88,
                memberEnd=122,
                removalStart=86,
                removalEnd=124,
            ),
        ],
        "constructors": [
            constructor_raw(),
        ],
    }
    raw.update(updates)
    return raw


class TestClassNode:
    def test_nullable_name(self) -> None:
        assert ClassNode(
            class_raw(
                name=None,
            )
        ).name is None

    def test_invalid_name(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="Class name",
        ):
            _ = ClassNode(
                class_raw(
                    name=123,
                )
            ).name

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            (
                "identifierStart",
                "identifier_start",
            ),
            (
                "identifierEnd",
                "identifier_end",
            ),
        ),
    )
    def test_optional_identifier_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ClassNode(
                class_raw(
                    **{
                        field: None,
                    }
                )
            ),
            property_name,
        ) is None

        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ClassNode(
                    class_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    @pytest.mark.parametrize(
        "value",
        (
            True,
            -1,
            "2",
        ),
    )
    def test_invalid_member_count(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="memberCount",
        ):
            _ = ClassNode(
                class_raw(
                    memberCount=value,
                )
            ).member_count

    def test_default_member_count(self) -> None:
        raw = class_raw()
        raw.pop("memberCount")

        assert ClassNode(raw).member_count == 2

    def test_invalid_members_structure(
        self,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="class.members",
        ):
            ClassNode(
                class_raw(
                    members="invalid",
                )
            ).members()

    def test_iter_and_kind_filter(self) -> None:
        node = ClassNode(class_raw())

        assert len(tuple(node.iter_members())) == 2
        assert len(
            node.members_of_kind("method")
        ) == 1
        assert (
            node.members_of_kind(
                "property"
            )[0].name
            == "value"
        )

    def test_members_of_kind_validation(
        self,
    ) -> None:
        node = ClassNode(class_raw())

        with pytest.raises(
            TypeError,
            match="kind must be a string",
        ):
            node.members_of_kind(123)

        with pytest.raises(
            ValueError,
            match="kind must be one",
        ):
            node.members_of_kind("unknown")

    def test_member_validation(self) -> None:
        node = ClassNode(class_raw())

        with pytest.raises(
            TypeError,
            match="name must be a string",
        ):
            node.member(123)

        with pytest.raises(
            ValueError,
            match="name cannot be empty",
        ):
            node.member("  ")

        with pytest.raises(
            TypeError,
            match="kind must be a string",
        ):
            node.member(
                "run",
                kind=123,
            )

        with pytest.raises(
            ValueError,
            match="kind must be one",
        ):
            node.member(
                "run",
                kind="unknown",
            )

    def test_member_lookup(self) -> None:
        node = ClassNode(class_raw())

        assert node.member("run").kind == "method"
        assert (
            node.member(
                "run",
                kind="method",
            ).name
            == "run"
        )
        assert node.has_member("run")
        assert not node.has_member("missing")
        assert (
            node.member(
                "missing",
                required=False,
            )
            is None
        )

        with pytest.raises(
            ASTNodeNotFound,
            match="does not contain",
        ):
            node.member("missing")

    def test_member_ambiguous(self) -> None:
        duplicate = class_member_raw(
            kind="property",
            name="value",
            start=130,
            end=160,
            memberStart=128,
            memberEnd=162,
            removalStart=126,
            removalEnd=164,
        )

        node = ClassNode(
            class_raw(
                members=[
                    class_member_raw(
                        kind="property",
                        name="value",
                    ),
                    duplicate,
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="more than one member",
        ):
            node.member("value")

    def test_same_name_different_kinds(
        self,
    ) -> None:
        node = ClassNode(
            class_raw(
                members=[
                    class_member_raw(
                        kind="method",
                        name="value",
                    ),
                    class_member_raw(
                        kind="property",
                        name="value",
                        start=100,
                        end=130,
                        memberStart=98,
                        memberEnd=132,
                        removalStart=96,
                        removalEnd=134,
                    ),
                ],
            )
        )

        assert (
            node.member(
                "value",
                kind="method",
            ).kind
            == "method"
        )

    def test_invalid_constructors(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="class.constructors",
        ):
            ClassNode(
                class_raw(
                    constructors="invalid",
                )
            ).constructors()

    def test_constructor_lookup(self) -> None:
        node = ClassNode(class_raw())

        assert node.constructor().start == 10
        assert node.has_constructor()

    def test_missing_constructor(self) -> None:
        node = ClassNode(
            class_raw(
                constructors=[],
            )
        )

        assert (
            node.constructor(
                required=False,
            )
            is None
        )
        assert not node.has_constructor()

        with pytest.raises(
            ASTNodeNotFound,
            match="does not contain",
        ):
            node.constructor()

    def test_multiple_constructors(self) -> None:
        node = ClassNode(
            class_raw(
                constructors=[
                    constructor_raw(),
                    constructor_raw(
                        start=50,
                        end=80,
                    ),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="more than one constructor",
        ):
            node.constructor()

    def test_all_properties(self) -> None:
        node = ClassNode(class_raw())

        assert node.name == "UserService"
        assert node.start == 0
        assert node.end == 200
        assert node.class_start == 0
        assert node.class_end == 200
        assert node.identifier_start == 6
        assert node.identifier_end == 17
        assert node.member_count == 2
        assert len(node.members()) == 2
