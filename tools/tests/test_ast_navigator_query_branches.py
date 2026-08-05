from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ASTNavigator,
    ASTNodeAmbiguous,
    ASTNodeNotFound,
    ClassMemberNode,
    InvalidASTStructure,
)


def named_import(
    imported: str = "alpha",
    local: str | None = None,
) -> dict:
    return {
        "imported": imported,
        "local": local or imported,
        "typeOnly": False,
        "start": 9,
        "end": 14,
    }


def import_raw(
    module: str = "./shared",
    *,
    local: str = "alpha",
) -> dict:
    return {
        "module": module,
        "quoteStyle": "'",
        "sideEffectOnly": False,
        "defaultImport": None,
        "namespaceImport": None,
        "typeOnly": False,
        "start": 0,
        "end": 30,
        "importClauseStart": 7,
        "importClauseEnd": 18,
        "namedBindingsStart": 7,
        "namedBindingsEnd": 16,
        "moduleSpecifierStart": 20,
        "moduleSpecifierEnd": 30,
        "namedImports": [
            named_import(
                imported="alpha",
                local=local,
            ),
        ],
    }


def named_export(
    local: str = "alpha",
    exported: str | None = None,
) -> dict:
    return {
        "local": local,
        "exported": exported or local,
        "typeOnly": False,
        "start": 9,
        "end": 14,
    }


def export_raw(
    module: str | None = "./shared",
    *,
    exported: str = "alpha",
    default: bool = False,
) -> dict:
    return {
        "module": module,
        "quoteStyle": "'",
        "exportAll": False,
        "namespaceExport": None,
        "typeOnly": False,
        "start": 0,
        "end": 30,
        "exportClauseStart": 7,
        "exportClauseEnd": 16,
        "moduleSpecifierStart": (
            20 if module is not None else None
        ),
        "moduleSpecifierEnd": (
            30 if module is not None else None
        ),
        "namedExports": [
            named_export(
                local="alpha",
                exported=exported,
            ),
        ],
        "default": default,
    }


def occurrence(
    start: int = 1,
    end: int = 6,
) -> dict:
    return {
        "start": start,
        "end": end,
        "prefixText": "",
        "suffixText": "",
    }


def rename_symbol(
    name: str = "alpha",
    *,
    kind: str = "function",
) -> dict:
    return {
        "name": name,
        "kind": kind,
        "declarationStart": 0,
        "declarationEnd": 20,
        "identifierStart": 9,
        "identifierEnd": 14,
        "occurrences": [
            occurrence(),
        ],
    }


def member_rename_symbol(
    class_name: str = "UserService",
    name: str = "run",
    *,
    kind: str = "method",
) -> dict:
    return {
        "className": class_name,
        "name": name,
        "kind": kind,
        "declarationStart": 0,
        "declarationEnd": 100,
        "memberStart": 20,
        "memberEnd": 80,
        "identifierStart": 25,
        "identifierEnd": 28,
        "occurrences": [
            occurrence(25, 28),
        ],
    }


def declaration_raw(
    name: str = "alpha",
    *,
    kind: str = "function",
    exported: bool = False,
    default: bool = False,
    names: list[str] | None = None,
) -> dict:
    return {
        "kind": kind,
        "name": name,
        "names": (
            names if names is not None else [name]
        ),
        "exported": exported,
        "default": default,
        "typeOnly": False,
        "modifiers": [],
        "start": 0,
        "end": 20,
        "startLine": 1,
        "startColumn": 1,
        "endLine": 1,
        "endColumn": 21,
        "modifierStart": 0,
        "keywordStart": 0,
        "exportModifierStart": None,
        "exportModifierEnd": None,
        "defaultModifierStart": None,
        "defaultModifierEnd": None,
        "removalStart": 0,
        "removalEnd": 21,
        "variableDeclarators": [],
        "declarationStart": 0,
        "declarationEnd": 20,
    }


def class_member(
    name: str = "run",
    *,
    kind: str = "method",
) -> dict:
    return {
        "kind": kind,
        "name": name,
        "start": 20,
        "end": 80,
        "memberStart": 18,
        "memberEnd": 82,
        "removalStart": 16,
        "removalEnd": 84,
        "identifierStart": 25,
        "identifierEnd": 28,
        "visibility": "public",
        "modifiers": [],
        "decorators": [],
        "parameters": [],
        "parameterCount": 0,
        "returnType": "void",
        "type": "string",
        "initializer": "'ready'",
        "bodyStart": 40,
        "bodyEnd": 79,
    }


def class_raw(
    name: str = "UserService",
    *,
    members: list[dict] | None = None,
) -> dict:
    return {
        "name": name,
        "start": 0,
        "end": 200,
        "classStart": 0,
        "classEnd": 200,
        "identifierStart": 6,
        "identifierEnd": 17,
        "members": (
            members
            if members is not None
            else [class_member()]
        ),
        "constructors": [],
    }


def bridge_result(**updates) -> dict:
    result = {
        "imports": [],
        "exports": [],
        "rename_symbols": [],
        "member_rename_symbols": [],
        "classes": [],
        "declarations": [],
        "exported_declarations": [],
    }
    result.update(updates)
    return result


class TestRemainingClassMemberBranches:
    def test_non_empty_type_and_initializer(
        self,
    ) -> None:
        node = ClassMemberNode(
            class_member()
        )

        assert node.type == "string"
        assert node.initializer == "'ready'"


class TestNavigatorInitialization:
    def test_none_bridge_result_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="cannot be None",
        ):
            ASTNavigator(None)

    def test_object_bridge_result(self) -> None:
        result = SimpleNamespace(
            imports=[
                import_raw(),
            ],
        )

        navigator = ASTNavigator(result)

        assert len(navigator.imports()) == 1


class TestImportQueries:
    def test_invalid_import_structure(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                imports="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="bridge_result.imports",
        ):
            navigator.imports()

    def test_import_collections(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                imports=[
                    import_raw("./shared"),
                    import_raw(
                        "./other",
                        local="beta",
                    ),
                ],
            )
        )

        assert len(navigator.imports()) == 2
        assert len(tuple(
            navigator.iter_imports()
        )) == 2
        assert len(
            navigator.imports_from(
                "./shared"
            )
        ) == 1
        assert (
            navigator.import_from(
                "./shared"
            ).module
            == "./shared"
        )
        assert navigator.has_local_import(
            "alpha"
        )
        assert navigator.has_local_import(
            "beta"
        )
        assert not navigator.has_local_import(
            "missing"
        )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_import_module_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="module must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).imports_from(value)

    def test_empty_import_module(self) -> None:
        with pytest.raises(
            ValueError,
            match="module cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).imports_from(" ")

    def test_missing_import(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.import_from(
            "./missing",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No import",
        ):
            navigator.import_from(
                "./missing"
            )

    def test_ambiguous_import(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                imports=[
                    import_raw("./shared"),
                    import_raw("./shared"),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one import",
        ):
            navigator.import_from(
                "./shared"
            )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_local_import_symbol_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).has_local_import(value)

    def test_empty_local_import_symbol(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).has_local_import(" ")


class TestExportQueries:
    def test_invalid_export_structure(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exports="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="bridge_result.exports",
        ):
            navigator.exports()

    def test_export_collections(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exports=[
                    export_raw("./shared"),
                    export_raw(
                        None,
                        exported="localValue",
                    ),
                ],
            )
        )

        assert len(navigator.exports()) == 2
        assert len(tuple(
            navigator.iter_exports()
        )) == 2
        assert len(
            navigator.exports_from(
                "./shared"
            )
        ) == 1
        assert (
            navigator.export_from(
                "./shared"
            ).module
            == "./shared"
        )
        assert len(
            navigator.local_exports()
        ) == 1
        assert navigator.has_exported_symbol(
            "alpha"
        )
        assert navigator.has_exported_symbol(
            "localValue"
        )
        assert not navigator.has_exported_symbol(
            "missing"
        )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_exports_from_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="module must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).exports_from(value)

    def test_empty_export_module(self) -> None:
        with pytest.raises(
            ValueError,
            match="module cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).exports_from(" ")

    def test_missing_export(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.export_from(
            "./missing",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No export",
        ):
            navigator.export_from(
                "./missing"
            )

    def test_ambiguous_export(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exports=[
                    export_raw("./shared"),
                    export_raw("./shared"),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one export",
        ):
            navigator.export_from(
                "./shared"
            )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_exported_symbol_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="symbol must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).has_exported_symbol(value)

    def test_empty_exported_symbol(self) -> None:
        with pytest.raises(
            ValueError,
            match="symbol cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).has_exported_symbol(" ")


class TestRenameSymbolQueries:
    def test_invalid_collection(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                rename_symbols="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="rename_symbols",
        ):
            navigator.rename_symbols()

    def test_collection_and_lookup(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                rename_symbols=[
                    rename_symbol("alpha"),
                ],
            )
        )

        assert len(
            navigator.rename_symbols()
        ) == 1
        assert len(tuple(
            navigator.iter_rename_symbols()
        )) == 1
        assert (
            navigator.rename_symbol(
                "alpha"
            ).name
            == "alpha"
        )
        assert navigator.has_rename_symbol(
            "alpha"
        )
        assert not navigator.has_rename_symbol(
            "missing"
        )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_name_type(self, value) -> None:
        with pytest.raises(
            TypeError,
            match="name must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).rename_symbol(value)

    def test_empty_name(self) -> None:
        with pytest.raises(
            ValueError,
            match="name cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).rename_symbol(" ")

    def test_missing_symbol(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.rename_symbol(
            "missing",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No rename symbol",
        ):
            navigator.rename_symbol(
                "missing"
            )

    def test_ambiguous_symbol(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                rename_symbols=[
                    rename_symbol("alpha"),
                    rename_symbol("alpha"),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one rename symbol",
        ):
            navigator.rename_symbol(
                "alpha"
            )


class TestMemberRenameQueries:
    def test_invalid_collection(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                member_rename_symbols="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="member_rename_symbols",
        ):
            navigator.member_rename_symbols()

    def test_collection_and_lookup(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                member_rename_symbols=[
                    member_rename_symbol(),
                ],
            )
        )

        assert len(
            navigator.member_rename_symbols()
        ) == 1
        assert len(tuple(
            navigator.iter_member_rename_symbols()
        )) == 1
        assert (
            navigator.member_rename_symbol(
                "UserService",
                "run",
            ).name
            == "run"
        )
        assert navigator.has_member_rename_symbol(
            "UserService",
            "run",
        )
        assert not navigator.has_member_rename_symbol(
            "UserService",
            "missing",
        )

    @pytest.mark.parametrize(
        (
            "class_name",
            "member_name",
            "kind",
            "message",
        ),
        (
            (
                123,
                "run",
                None,
                "class_name",
            ),
            (
                "UserService",
                123,
                None,
                "member_name",
            ),
            (
                "UserService",
                "run",
                123,
                "kind",
            ),
        ),
    )
    def test_argument_types(
        self,
        class_name,
        member_name,
        kind,
        message: str,
    ) -> None:
        with pytest.raises(
            TypeError,
            match=message,
        ):
            ASTNavigator(
                bridge_result()
            ).member_rename_symbol(
                class_name,
                member_name,
                kind=kind,
            )

    @pytest.mark.parametrize(
        (
            "class_name",
            "member_name",
            "message",
        ),
        (
            (
                " ",
                "run",
                "class_name cannot be empty",
            ),
            (
                "UserService",
                " ",
                "member_name cannot be empty",
            ),
        ),
    )
    def test_empty_names(
        self,
        class_name: str,
        member_name: str,
        message: str,
    ) -> None:
        with pytest.raises(
            ValueError,
            match=message,
        ):
            ASTNavigator(
                bridge_result()
            ).member_rename_symbol(
                class_name,
                member_name,
            )

    def test_invalid_kind(self) -> None:
        with pytest.raises(
            ValueError,
            match="kind must be method",
        ):
            ASTNavigator(
                bridge_result()
            ).member_rename_symbol(
                "UserService",
                "run",
                kind="constructor",
            )

    def test_kind_filter(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                member_rename_symbols=[
                    member_rename_symbol(
                        kind="method",
                    ),
                    member_rename_symbol(
                        kind="property",
                    ),
                ],
            )
        )

        assert (
            navigator.member_rename_symbol(
                "UserService",
                "run",
                kind="method",
            ).kind
            == "method"
        )

    def test_ambiguous_member(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                member_rename_symbols=[
                    member_rename_symbol(),
                    member_rename_symbol(),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="more than one",
        ):
            navigator.member_rename_symbol(
                "UserService",
                "run",
            )

    def test_missing_member(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.member_rename_symbol(
            "UserService",
            "run",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No renameable member",
        ):
            navigator.member_rename_symbol(
                "UserService",
                "run",
                kind="method",
            )


class TestClassQueries:
    def test_invalid_classes_structure(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result(
                classes="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="bridge_result.classes",
        ):
            navigator.classes()

    def test_collection_aliases(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                classes=[
                    class_raw(),
                ],
            )
        )

        assert len(navigator.classes()) == 1
        assert len(tuple(
            navigator.iter_classes()
        )) == 1
        assert (
            navigator.class_node(
                "UserService"
            ).name
            == "UserService"
        )
        assert (
            navigator.class_member(
                "UserService",
                "run",
            ).name
            == "run"
        )

    def test_optional_missing_class_member(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.class_member(
            "Missing",
            "run",
            required=False,
        ) is None

    def test_legacy_class_validation(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        with pytest.raises(
            TypeError,
            match="class name",
        ):
            navigator.class_(123)

        with pytest.raises(
            ValueError,
            match="class name cannot be empty",
        ):
            navigator.class_(" ")

    def test_no_unnamed_class(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.class_(
            required=False
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No TypeScript class",
        ):
            navigator.class_()


class TestDeclarationQueries:
    def test_invalid_collection(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                declarations="invalid",
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="bridge_result.declarations",
        ):
            navigator.declarations()

    def test_collection_and_kind_filter(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result(
                declarations=[
                    declaration_raw(
                        "alpha",
                        kind="function",
                    ),
                    declaration_raw(
                        "User",
                        kind="class",
                    ),
                ],
            )
        )

        assert len(
            navigator.declarations()
        ) == 2
        assert len(tuple(
            navigator.iter_declarations()
        )) == 2
        assert len(
            navigator.declarations_of_kind(
                "function"
            )
        ) == 1
        assert (
            navigator.declaration(
                "alpha"
            ).name
            == "alpha"
        )
        assert navigator.has_declaration(
            "alpha"
        )
        assert not navigator.has_declaration(
            "missing"
        )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_kind_type(self, value) -> None:
        with pytest.raises(
            TypeError,
            match="kind must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).declarations_of_kind(
                value
            )

    @pytest.mark.parametrize(
        "value",
        (
            "",
            " ",
            "method",
        ),
    )
    def test_invalid_kind(
        self,
        value: str,
    ) -> None:
        expected = (
            "cannot be empty"
            if not value.strip()
            else "kind must be one"
        )

        with pytest.raises(
            ValueError,
            match=expected,
        ):
            ASTNavigator(
                bridge_result()
            ).declarations_of_kind(
                value
            )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_declaration_name_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="name must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).declaration(value)

    def test_empty_declaration_name(
        self,
    ) -> None:
        with pytest.raises(
            ValueError,
            match="name cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).declaration(" ")

    def test_missing_declaration(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.declaration(
            "missing",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No declaration",
        ):
            navigator.declaration(
                "missing"
            )

    def test_ambiguous_declaration(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                declarations=[
                    declaration_raw("alpha"),
                    declaration_raw(
                        "other",
                        names=["alpha"],
                    ),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one declaration",
        ):
            navigator.declaration(
                "alpha"
            )


class TestExportedDeclarationQueries:
    def test_invalid_collection(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exported_declarations=(
                    "invalid"
                ),
            )
        )

        with pytest.raises(
            InvalidASTStructure,
            match="exported_declarations",
        ):
            navigator.exported_declarations()

    def test_collection_and_kind_filter(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exported_declarations=[
                    declaration_raw(
                        "alpha",
                        kind="function",
                        exported=True,
                    ),
                    declaration_raw(
                        "User",
                        kind="class",
                        exported=True,
                        default=True,
                    ),
                ],
            )
        )

        assert len(
            navigator.exported_declarations()
        ) == 2
        assert len(tuple(
            navigator.iter_exported_declarations()
        )) == 2
        assert len(
            navigator.exported_declarations_of_kind(
                "class"
            )
        ) == 1
        assert (
            navigator.exported_declaration(
                "alpha"
            ).name
            == "alpha"
        )
        assert (
            navigator.default_exported_declaration()
            .name
            == "User"
        )
        assert navigator.has_exported_declaration(
            "alpha"
        )
        assert not navigator.has_exported_declaration(
            "missing"
        )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_exported_kind_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="kind must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).exported_declarations_of_kind(
                value
            )

    @pytest.mark.parametrize(
        "value",
        (
            "",
            " ",
            "method",
        ),
    )
    def test_invalid_exported_kind(
        self,
        value: str,
    ) -> None:
        expected = (
            "cannot be empty"
            if not value.strip()
            else "kind must be one"
        )

        with pytest.raises(
            ValueError,
            match=expected,
        ):
            ASTNavigator(
                bridge_result()
            ).exported_declarations_of_kind(
                value
            )

    @pytest.mark.parametrize(
        "value",
        (
            123,
            None,
        ),
    )
    def test_exported_name_type(
        self,
        value,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="name must be a string",
        ):
            ASTNavigator(
                bridge_result()
            ).exported_declaration(value)

    def test_empty_exported_name(self) -> None:
        with pytest.raises(
            ValueError,
            match="name cannot be empty",
        ):
            ASTNavigator(
                bridge_result()
            ).exported_declaration(" ")

    def test_missing_exported_declaration(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert navigator.exported_declaration(
            "missing",
            required=False,
        ) is None

        with pytest.raises(
            ASTNodeNotFound,
            match="No exported declaration",
        ):
            navigator.exported_declaration(
                "missing"
            )

    def test_ambiguous_exported_declaration(
        self,
    ) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exported_declarations=[
                    declaration_raw(
                        "alpha",
                        exported=True,
                    ),
                    declaration_raw(
                        "other",
                        exported=True,
                        names=["alpha"],
                    ),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one exported",
        ):
            navigator.exported_declaration(
                "alpha"
            )

    def test_missing_default_export(self) -> None:
        navigator = ASTNavigator(
            bridge_result()
        )

        assert (
            navigator.default_exported_declaration(
                required=False,
            )
            is None
        )

        with pytest.raises(
            ASTNodeNotFound,
            match="No default exported",
        ):
            navigator.default_exported_declaration()

    def test_ambiguous_default_export(self) -> None:
        navigator = ASTNavigator(
            bridge_result(
                exported_declarations=[
                    declaration_raw(
                        "First",
                        exported=True,
                        default=True,
                    ),
                    declaration_raw(
                        "Second",
                        exported=True,
                        default=True,
                    ),
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one default",
        ):
            navigator.default_exported_declaration()
