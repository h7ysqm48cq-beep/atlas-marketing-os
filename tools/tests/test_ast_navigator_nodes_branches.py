from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.ast_navigator import (
    ASTNodeAmbiguous,
    ASTNodeNotFound,
    ConstructorNode,
    ExportedDeclarationNode,
    ExportNode,
    ImportNode,
    InvalidASTStructure,
    NamedExportNode,
    NamedImportNode,
    ParameterNode,
    RenameOccurrenceNode,
    RenameSymbolNode,
    VariableDeclaratorNode,
    _as_node_sequence,
    _read_field,
    _required_integer,
)


class TestHelpers:
    def test_read_field_from_mapping(self) -> None:
        assert _read_field(
            {"name": "alpha"},
            "name",
        ) == "alpha"

    def test_read_field_from_object(self) -> None:
        value = SimpleNamespace(
            name="alpha"
        )

        assert _read_field(
            value,
            "name",
        ) == "alpha"

    def test_read_field_default(self) -> None:
        assert _read_field(
            {},
            "missing",
            "fallback",
        ) == "fallback"

    def test_none_sequence_becomes_empty(
        self,
    ) -> None:
        assert (
            _as_node_sequence(
                None,
                "items",
            )
            == ()
        )

    @pytest.mark.parametrize(
        "value",
        (
            "invalid",
            b"invalid",
            123,
            object(),
        ),
    )
    def test_invalid_node_sequence(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="must be a sequence",
        ):
            _as_node_sequence(
                value,
                "items",
            )

    def test_valid_node_sequence(self) -> None:
        assert _as_node_sequence(
            [1, 2],
            "items",
        ) == (1, 2)

    @pytest.mark.parametrize(
        "value",
        (
            True,
            "1",
            1.5,
            None,
        ),
    )
    def test_required_integer_rejected(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="must be an integer",
        ):
            _required_integer(
                {"position": value},
                "position",
            )

    def test_required_integer_valid(self) -> None:
        assert _required_integer(
            {"position": 4},
            "position",
        ) == 4


class TestParameterNode:
    def test_nullable_name_and_type(self) -> None:
        node = ParameterNode(
            {
                "name": None,
                "type": None,
            }
        )

        assert node.name is None
        assert node.type is None

    @pytest.mark.parametrize(
        (
            "field",
            "message",
        ),
        (
            (
                "name",
                "Parameter name",
            ),
            (
                "type",
                "Parameter type",
            ),
        ),
    )
    def test_invalid_name_or_type(
        self,
        field: str,
        message: str,
    ) -> None:
        node = ParameterNode(
            {
                field: 123,
            }
        )

        with pytest.raises(
            InvalidASTStructure,
            match=message,
        ):
            getattr(node, field)

    def test_all_properties(self) -> None:
        node = ParameterNode(
            {
                "name": "service",
                "type": "Service",
                "start": 1,
                "end": 8,
                "modifiers": [
                    "private",
                    "readonly",
                ],
                "decorators": [
                    {"name": "Inject"},
                ],
            }
        )

        assert node.name == "service"
        assert node.type == "Service"
        assert node.start == 1
        assert node.end == 8
        assert node.modifiers == (
            "private",
            "readonly",
        )
        assert node.decorators == (
            {"name": "Inject"},
        )

    def test_none_modifiers(self) -> None:
        assert ParameterNode(
            {
                "modifiers": None,
            }
        ).modifiers == ()

    @pytest.mark.parametrize(
        "value",
        (
            "private",
            b"private",
        ),
    )
    def test_invalid_modifiers(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="modifiers must be a sequence",
        ):
            _ = ParameterNode(
                {
                    "modifiers": value,
                }
            ).modifiers

    def test_invalid_decorators(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="parameter.decorators",
        ):
            _ = ParameterNode(
                {
                    "decorators": "Inject",
                }
            ).decorators


def parameter_raw(
    name: str,
    *,
    start: int = 1,
    end: int = 2,
) -> dict:
    return {
        "name": name,
        "type": "string",
        "start": start,
        "end": end,
    }


class TestConstructorNode:
    def test_properties_and_parameters(self) -> None:
        node = ConstructorNode(
            {
                "start": 1,
                "end": 30,
                "bodyStart": 20,
                "bodyEnd": 29,
                "parameters": [
                    parameter_raw(
                        "alpha",
                        start=5,
                        end=10,
                    ),
                ],
            }
        )

        assert node.start == 1
        assert node.end == 30
        assert node.body_start == 20
        assert node.body_end == 29
        assert (
            node.parameters()[0].name
            == "alpha"
        )

    def test_invalid_parameters_structure(
        self,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="constructor.parameters",
        ):
            ConstructorNode(
                {
                    "parameters": "alpha",
                }
            ).parameters()

    def test_parameter_name_type_rejected(
        self,
    ) -> None:
        node = ConstructorNode(
            {
                "parameters": [],
            }
        )

        with pytest.raises(
            TypeError,
            match="parameter name",
        ):
            node.parameter(123)

    def test_empty_parameter_name_rejected(
        self,
    ) -> None:
        node = ConstructorNode(
            {
                "parameters": [],
            }
        )

        with pytest.raises(
            ValueError,
            match="cannot be empty",
        ):
            node.parameter("   ")

    def test_duplicate_parameter_ambiguous(
        self,
    ) -> None:
        node = ConstructorNode(
            {
                "parameters": [
                    parameter_raw("alpha"),
                    parameter_raw(
                        "alpha",
                        start=3,
                        end=4,
                    ),
                ],
            }
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one",
        ):
            node.parameter("alpha")

    def test_missing_parameter_required(
        self,
    ) -> None:
        node = ConstructorNode(
            {
                "parameters": [],
            }
        )

        with pytest.raises(
            ASTNodeNotFound,
            match="was not found",
        ):
            node.parameter("alpha")

    def test_missing_parameter_optional(
        self,
    ) -> None:
        node = ConstructorNode(
            {
                "parameters": [],
            }
        )

        assert node.parameter(
            "alpha",
            required=False,
        ) is None
        assert node.has_parameter(
            "alpha"
        ) is False
        assert node.first_parameter() is None
        assert node.last_parameter() is None


class TestNamedImportNode:
    @pytest.mark.parametrize(
        (
            "field",
            "message",
        ),
        (
            (
                "imported",
                "imported name",
            ),
            (
                "local",
                "local name",
            ),
        ),
    )
    @pytest.mark.parametrize(
        "value",
        (
            None,
            "",
            123,
        ),
    )
    def test_invalid_names(
        self,
        field: str,
        message: str,
        value,
    ) -> None:
        raw = {
            "imported": "alpha",
            "local": "alpha",
            field: value,
        }

        with pytest.raises(
            InvalidASTStructure,
            match=message,
        ):
            getattr(
                NamedImportNode(raw),
                field,
            )

    def test_invalid_type_only(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="typeOnly",
        ):
            _ = NamedImportNode(
                {
                    "imported": "alpha",
                    "local": "alpha",
                    "typeOnly": "yes",
                }
            ).type_only

    def test_properties(self) -> None:
        node = NamedImportNode(
            {
                "imported": "alpha",
                "local": "beta",
                "typeOnly": True,
                "start": 1,
                "end": 5,
            }
        )

        assert node.imported == "alpha"
        assert node.local == "beta"
        assert node.type_only is True
        assert node.start == 1
        assert node.end == 5
        assert node.aliased is True


def import_raw(**updates) -> dict:
    raw = {
        "module": "./shared",
        "quoteStyle": "'",
        "sideEffectOnly": False,
        "defaultImport": None,
        "namespaceImport": None,
        "typeOnly": False,
        "start": 0,
        "end": 30,
        "importClauseStart": 7,
        "importClauseEnd": 20,
        "namedBindingsStart": 7,
        "namedBindingsEnd": 16,
        "moduleSpecifierStart": 22,
        "moduleSpecifierEnd": 30,
        "namedImports": [
            {
                "imported": "alpha",
                "local": "beta",
                "typeOnly": False,
                "start": 9,
                "end": 14,
            }
        ],
    }
    raw.update(updates)
    return raw


class TestImportNode:
    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
            "message",
            "value",
        ),
        (
            (
                "module",
                "module",
                "Import module",
                "",
            ),
            (
                "quoteStyle",
                "quote_style",
                "quoteStyle",
                "`",
            ),
            (
                "sideEffectOnly",
                "side_effect_only",
                "sideEffectOnly",
                "false",
            ),
            (
                "defaultImport",
                "default_import",
                "defaultImport",
                123,
            ),
            (
                "namespaceImport",
                "namespace_import",
                "namespaceImport",
                123,
            ),
            (
                "typeOnly",
                "type_only",
                "typeOnly",
                "false",
            ),
        ),
    )
    def test_invalid_scalar_fields(
        self,
        field: str,
        property_name: str,
        message: str,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match=message,
        ):
            getattr(
                ImportNode(
                    import_raw(
                        **{
                            field: value,
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
            (
                "importClauseStart",
                "import_clause_start",
            ),
            (
                "importClauseEnd",
                "import_clause_end",
            ),
            (
                "namedBindingsStart",
                "named_bindings_start",
            ),
            (
                "namedBindingsEnd",
                "named_bindings_end",
            ),
        ),
    )
    def test_optional_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ImportNode(
                import_raw(
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
                ImportNode(
                    import_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    def test_all_properties_and_contains(
        self,
    ) -> None:
        node = ImportNode(import_raw())

        assert node.module == "./shared"
        assert node.quote_style == "'"
        assert node.side_effect_only is False
        assert node.default_import is None
        assert node.namespace_import is None
        assert node.type_only is False
        assert node.start == 0
        assert node.end == 30
        assert node.import_clause_start == 7
        assert node.import_clause_end == 20
        assert node.named_bindings_start == 7
        assert node.named_bindings_end == 16
        assert node.module_specifier_start == 22
        assert node.module_specifier_end == 30
        assert len(node.named_imports()) == 1
        assert node.contains_local("beta")
        assert node.contains_imported("alpha")
        assert not node.contains_local("missing")
        assert not node.contains_imported(
            "missing"
        )

    def test_contains_default_and_namespace(
        self,
    ) -> None:
        default_node = ImportNode(
            import_raw(
                defaultImport="React",
                namedImports=[],
            )
        )
        namespace_node = ImportNode(
            import_raw(
                namespaceImport="ReactNS",
                namedImports=[],
            )
        )

        assert default_node.contains_local(
            "React"
        )
        assert namespace_node.contains_local(
            "ReactNS"
        )

    def test_invalid_named_imports(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="import.namedImports",
        ):
            ImportNode(
                import_raw(
                    namedImports="alpha",
                )
            ).named_imports()


class TestNamedExportNode:
    @pytest.mark.parametrize(
        (
            "field",
            "message",
            "value",
        ),
        (
            (
                "local",
                "local name",
                "",
            ),
            (
                "exported",
                "exported name",
                123,
            ),
        ),
    )
    def test_invalid_names(
        self,
        field: str,
        message: str,
        value,
    ) -> None:
        raw = {
            "local": "alpha",
            "exported": "alpha",
            field: value,
        }

        with pytest.raises(
            InvalidASTStructure,
            match=message,
        ):
            getattr(
                NamedExportNode(raw),
                field,
            )

    def test_invalid_type_only(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="typeOnly",
        ):
            _ = NamedExportNode(
                {
                    "local": "alpha",
                    "exported": "alpha",
                    "typeOnly": "yes",
                }
            ).type_only

    def test_properties(self) -> None:
        node = NamedExportNode(
            {
                "local": "alpha",
                "exported": "beta",
                "typeOnly": True,
                "start": 1,
                "end": 5,
            }
        )

        assert node.local == "alpha"
        assert node.exported == "beta"
        assert node.type_only is True
        assert node.start == 1
        assert node.end == 5
        assert node.aliased is True


class TestRenameNodes:
    def test_occurrence_properties(self) -> None:
        node = RenameOccurrenceNode(
            {
                "start": 1,
                "end": 5,
                "prefixText": "pre",
                "suffixText": "post",
            }
        )

        assert node.start == 1
        assert node.end == 5
        assert node.prefix_text == "pre"
        assert node.suffix_text == "post"

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            (
                "prefixText",
                "prefix_text",
            ),
            (
                "suffixText",
                "suffix_text",
            ),
        ),
    )
    def test_invalid_occurrence_text(
        self,
        field: str,
        property_name: str,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                RenameOccurrenceNode(
                    {
                        field: 123,
                    }
                ),
                property_name,
            )

    @pytest.mark.parametrize(
        "value",
        (
            None,
            "",
            123,
        ),
    )
    def test_invalid_symbol_name(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="symbol name",
        ):
            _ = RenameSymbolNode(
                {
                    "name": value,
                }
            ).name

    def test_invalid_symbol_kind(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="kind is invalid",
        ):
            _ = RenameSymbolNode(
                {
                    "kind": "method",
                }
            ).kind

    def test_symbol_properties(self) -> None:
        node = RenameSymbolNode(
            {
                "name": "alpha",
                "kind": "function",
                "declarationStart": 0,
                "declarationEnd": 20,
                "identifierStart": 9,
                "identifierEnd": 14,
                "occurrences": [
                    {
                        "start": 9,
                        "end": 14,
                    }
                ],
            }
        )

        assert node.name == "alpha"
        assert node.kind == "function"
        assert node.declaration_start == 0
        assert node.declaration_end == 20
        assert node.identifier_start == 9
        assert node.identifier_end == 14
        assert len(node.occurrences) == 1

    def test_invalid_occurrences(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="rename_symbol.occurrences",
        ):
            _ = RenameSymbolNode(
                {
                    "occurrences": "invalid",
                }
            ).occurrences


class TestVariableDeclaratorNode:
    @pytest.mark.parametrize(
        "value",
        (
            "alpha",
            None,
            123,
        ),
    )
    def test_invalid_names_sequence(
        self,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="names must be a sequence",
        ):
            _ = VariableDeclaratorNode(
                {
                    "names": value,
                }
            ).names

    def test_invalid_names_content(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="must contain strings",
        ):
            _ = VariableDeclaratorNode(
                {
                    "names": [
                        "alpha",
                        123,
                    ],
                }
            ).names

    def test_invalid_destructuring(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="destructuring",
        ):
            _ = VariableDeclaratorNode(
                {
                    "destructuring": "no",
                }
            ).destructuring

    def test_properties(self) -> None:
        node = VariableDeclaratorNode(
            {
                "names": [
                    "alpha",
                ],
                "destructuring": False,
                "start": 1,
                "end": 8,
                "removalStart": 0,
                "removalEnd": 9,
            }
        )

        assert node.names == ("alpha",)
        assert node.contains_name("alpha")
        assert node.destructuring is False
        assert node.start == 1
        assert node.end == 8
        assert node.removal_start == 0
        assert node.removal_end == 9


def declaration_raw(**updates) -> dict:
    raw = {
        "kind": "function",
        "name": "alpha",
        "names": [
            "alpha",
        ],
        "exported": True,
        "default": False,
        "typeOnly": False,
        "modifiers": [
            "export",
        ],
        "start": 0,
        "end": 20,
        "startLine": 1,
        "startColumn": 1,
        "endLine": 1,
        "endColumn": 21,
        "modifierStart": 0,
        "keywordStart": 7,
        "exportModifierStart": 0,
        "exportModifierEnd": 6,
        "defaultModifierStart": None,
        "defaultModifierEnd": None,
        "removalStart": 0,
        "removalEnd": 21,
        "variableDeclarators": [],
        "declarationStart": 0,
        "declarationEnd": 20,
    }
    raw.update(updates)
    return raw


class TestExportedDeclarationNode:
    def test_invalid_kind(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="kind must be one",
        ):
            _ = ExportedDeclarationNode(
                declaration_raw(
                    kind="method",
                )
            ).kind

    def test_nullable_name(self) -> None:
        assert ExportedDeclarationNode(
            declaration_raw(
                name=None,
            )
        ).name is None

    @pytest.mark.parametrize(
        "value",
        (
            "",
            123,
        ),
    )
    def test_invalid_name(self, value) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="name must be",
        ):
            _ = ExportedDeclarationNode(
                declaration_raw(
                    name=value,
                )
            ).name

    def test_invalid_names_structure(
        self,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="exported_declaration.names",
        ):
            _ = ExportedDeclarationNode(
                declaration_raw(
                    names="alpha",
                )
            ).names

    def test_invalid_names_content(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="non-empty strings",
        ):
            _ = ExportedDeclarationNode(
                declaration_raw(
                    names=[
                        "",
                    ],
                )
            ).names

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            (
                "exported",
                "exported",
            ),
            (
                "default",
                "default",
            ),
            (
                "typeOnly",
                "type_only",
            ),
        ),
    )
    def test_invalid_boolean_fields(
        self,
        field: str,
        property_name: str,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match=field,
        ):
            getattr(
                ExportedDeclarationNode(
                    declaration_raw(
                        **{
                            field: "yes",
                        }
                    )
                ),
                property_name,
            )

    def test_invalid_modifiers(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="modifiers",
        ):
            _ = ExportedDeclarationNode(
                declaration_raw(
                    modifiers=[
                        "",
                    ],
                )
            ).modifiers

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
        ),
        (
            (
                "exportModifierStart",
                "export_modifier_start",
            ),
            (
                "exportModifierEnd",
                "export_modifier_end",
            ),
            (
                "defaultModifierStart",
                "default_modifier_start",
            ),
            (
                "defaultModifierEnd",
                "default_modifier_end",
            ),
        ),
    )
    def test_optional_modifier_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ExportedDeclarationNode(
                declaration_raw(
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
                ExportedDeclarationNode(
                    declaration_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    def test_variable_declarators(
        self,
    ) -> None:
        node = ExportedDeclarationNode(
            declaration_raw(
                kind="variable",
                variableDeclarators=[
                    {
                        "names": [
                            "alpha",
                        ],
                    },
                ],
            )
        )

        assert (
            node.variable_declarator(
                "alpha"
            ).names
            == ("alpha",)
        )
        assert node.variable_declarator(
            "missing"
        ) is None

    def test_ambiguous_variable_declarator(
        self,
    ) -> None:
        node = ExportedDeclarationNode(
            declaration_raw(
                kind="variable",
                variableDeclarators=[
                    {
                        "names": [
                            "alpha",
                        ],
                    },
                    {
                        "names": [
                            "alpha",
                        ],
                    },
                ],
            )
        )

        with pytest.raises(
            ASTNodeAmbiguous,
            match="More than one",
        ):
            node.variable_declarator(
                "alpha"
            )

    def test_all_properties(self) -> None:
        node = ExportedDeclarationNode(
            declaration_raw()
        )

        assert node.kind == "function"
        assert node.name == "alpha"
        assert node.names == ("alpha",)
        assert node.exported is True
        assert node.default is False
        assert node.type_only is False
        assert node.modifiers == ("export",)
        assert node.start == 0
        assert node.end == 20
        assert node.start_line == 1
        assert node.start_column == 1
        assert node.end_line == 1
        assert node.end_column == 21
        assert node.modifier_start == 0
        assert node.keyword_start == 7
        assert node.export_modifier_start == 0
        assert node.export_modifier_end == 6
        assert node.removal_start == 0
        assert node.removal_end == 21
        assert node.declaration_start == 0
        assert node.declaration_end == 20
        assert node.contains_name("alpha")
        assert not node.contains_name(
            "missing"
        )


def export_raw(**updates) -> dict:
    raw = {
        "module": "./shared",
        "quoteStyle": "'",
        "exportAll": False,
        "namespaceExport": None,
        "typeOnly": False,
        "start": 0,
        "end": 25,
        "exportClauseStart": 7,
        "exportClauseEnd": 16,
        "moduleSpecifierStart": 18,
        "moduleSpecifierEnd": 25,
        "namedExports": [
            {
                "local": "alpha",
                "exported": "beta",
                "typeOnly": False,
                "start": 9,
                "end": 14,
            }
        ],
    }
    raw.update(updates)
    return raw


class TestExportNode:
    def test_nullable_module(self) -> None:
        assert ExportNode(
            export_raw(
                module=None,
            )
        ).module is None

    @pytest.mark.parametrize(
        (
            "field",
            "property_name",
            "value",
        ),
        (
            (
                "module",
                "module",
                "",
            ),
            (
                "quoteStyle",
                "quote_style",
                "`",
            ),
            (
                "exportAll",
                "export_all",
                "yes",
            ),
            (
                "namespaceExport",
                "namespace_export",
                "",
            ),
            (
                "typeOnly",
                "type_only",
                "yes",
            ),
        ),
    )
    def test_invalid_fields(
        self,
        field: str,
        property_name: str,
        value,
    ) -> None:
        with pytest.raises(
            InvalidASTStructure,
        ):
            getattr(
                ExportNode(
                    export_raw(
                        **{
                            field: value,
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
            (
                "exportClauseStart",
                "export_clause_start",
            ),
            (
                "exportClauseEnd",
                "export_clause_end",
            ),
            (
                "moduleSpecifierStart",
                "module_specifier_start",
            ),
            (
                "moduleSpecifierEnd",
                "module_specifier_end",
            ),
        ),
    )
    def test_optional_offsets(
        self,
        field: str,
        property_name: str,
    ) -> None:
        assert getattr(
            ExportNode(
                export_raw(
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
                ExportNode(
                    export_raw(
                        **{
                            field: True,
                        }
                    )
                ),
                property_name,
            )

    def test_properties_and_contains(
        self,
    ) -> None:
        node = ExportNode(export_raw())

        assert node.module == "./shared"
        assert node.quote_style == "'"
        assert node.export_all is False
        assert node.namespace_export is None
        assert node.type_only is False
        assert node.start == 0
        assert node.end == 25
        assert node.export_clause_start == 7
        assert node.export_clause_end == 16
        assert node.module_specifier_start == 18
        assert node.module_specifier_end == 25
        assert len(node.named_exports()) == 1
        assert node.contains_local("alpha")
        assert node.contains_exported(
            "beta"
        )
        assert not node.contains_local(
            "missing"
        )
        assert not node.contains_exported(
            "missing"
        )

    def test_namespace_contains_exported(
        self,
    ) -> None:
        node = ExportNode(
            export_raw(
                namespaceExport="Shared",
                namedExports=[],
            )
        )

        assert node.contains_exported(
            "Shared"
        )

    def test_invalid_named_exports(self) -> None:
        with pytest.raises(
            InvalidASTStructure,
            match="export.namedExports",
        ):
            ExportNode(
                export_raw(
                    namedExports="alpha",
                )
            ).named_exports()
