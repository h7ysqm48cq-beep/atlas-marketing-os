from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Iterator


class ASTNavigatorError(RuntimeError):
    """Base error raised by the AST navigation layer."""


class InvalidASTStructure(ASTNavigatorError):
    """Raised when bridge data has an unexpected structure."""


class ASTNodeNotFound(ASTNavigatorError):
    """Raised when a requested AST node cannot be found."""


class ASTNodeAmbiguous(ASTNavigatorError):
    """Raised when more than one node matches a lookup."""


def _read_field(
    value: Any,
    field_name: str,
    default: Any = None,
) -> Any:
    """
    Read a field from either a mapping or an object.

    TypeScriptBridge currently returns a BridgeResult object containing
    dictionaries, but supporting both forms keeps the navigator reusable.
    """

    if isinstance(value, Mapping):
        return value.get(field_name, default)

    return getattr(value, field_name, default)


def _as_node_sequence(
    value: Any,
    field_name: str,
) -> tuple[Any, ...]:
    if value is None:
        return ()

    if isinstance(value, (str, bytes)):
        raise InvalidASTStructure(
            f"{field_name} must be a sequence of AST nodes"
        )

    if not isinstance(value, Sequence):
        raise InvalidASTStructure(
            f"{field_name} must be a sequence of AST nodes"
        )

    return tuple(value)


def _required_integer(
    node: Any,
    field_name: str,
) -> int:
    value = _read_field(node, field_name)

    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidASTStructure(
            f"AST field {field_name!r} must be an integer"
        )

    return value


@dataclass(frozen=True, slots=True)
class ParameterNode:
    raw: Any

    @property
    def name(self) -> str | None:
        value = _read_field(self.raw, "name")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Parameter name must be a string"
            )

        return value

    @property
    def type(self) -> str | None:
        value = _read_field(self.raw, "type")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Parameter type must be a string"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def modifiers(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "modifiers",
            (),
        )

        if values is None:
            return ()

        if isinstance(values, (str, bytes)):
            raise InvalidASTStructure(
                "Parameter modifiers must be a sequence"
            )

        return tuple(values)

    @property
    def decorators(self) -> tuple[Any, ...]:
        values = _read_field(
            self.raw,
            "decorators",
            (),
        )

        return _as_node_sequence(
            values,
            "parameter.decorators",
        )


@dataclass(frozen=True, slots=True)
class ConstructorNode:
    raw: Any

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def body_start(self) -> int:
        return _required_integer(
            self.raw,
            "bodyStart",
        )

    @property
    def body_end(self) -> int:
        return _required_integer(
            self.raw,
            "bodyEnd",
        )

    def parameters(self) -> tuple[ParameterNode, ...]:
        values = _read_field(
            self.raw,
            "parameters",
            (),
        )

        return tuple(
            ParameterNode(raw=node)
            for node in _as_node_sequence(
                values,
                "constructor.parameters",
            )
        )

    def parameter(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> ParameterNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "parameter name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "parameter name cannot be empty"
            )

        matches = [
            parameter
            for parameter in self.parameters()
            if parameter.name == normalized
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one constructor parameter "
                f"named {normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"Constructor parameter "
                f"{normalized!r} was not found"
            )

        return None

    def has_parameter(
        self,
        name: str,
    ) -> bool:
        return (
            self.parameter(
                name,
                required=False,
            )
            is not None
        )

    def first_parameter(
        self,
    ) -> ParameterNode | None:
        parameters = self.parameters()

        if not parameters:
            return None

        return parameters[0]

    def last_parameter(
        self,
    ) -> ParameterNode | None:
        parameters = self.parameters()

        if not parameters:
            return None

        return parameters[-1]



@dataclass(frozen=True, slots=True)
class NamedImportNode:
    raw: Any

    @property
    def imported(self) -> str:
        value = _read_field(
            self.raw,
            "imported",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Named import imported name must be "
                "a non-empty string"
            )

        return value

    @property
    def local(self) -> str:
        value = _read_field(
            self.raw,
            "local",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Named import local name must be "
                "a non-empty string"
            )

        return value

    @property
    def type_only(self) -> bool:
        value = _read_field(
            self.raw,
            "typeOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Named import typeOnly must be a boolean"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def aliased(self) -> bool:
        return self.imported != self.local


@dataclass(frozen=True, slots=True)
class ImportNode:
    raw: Any

    @property
    def module(self) -> str:
        value = _read_field(
            self.raw,
            "module",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Import module must be a non-empty string"
            )

        return value

    @property
    def quote_style(self) -> str:
        value = _read_field(
            self.raw,
            "quoteStyle",
        )

        if value not in {"'", '"'}:
            raise InvalidASTStructure(
                "Import quoteStyle must be a single "
                "or double quote"
            )

        return value

    @property
    def side_effect_only(self) -> bool:
        value = _read_field(
            self.raw,
            "sideEffectOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Import sideEffectOnly must be a boolean"
            )

        return value

    @property
    def default_import(self) -> str | None:
        value = _read_field(
            self.raw,
            "defaultImport",
        )

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Import defaultImport must be "
                "a string or null"
            )

        return value

    @property
    def namespace_import(self) -> str | None:
        value = _read_field(
            self.raw,
            "namespaceImport",
        )

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Import namespaceImport must be "
                "a string or null"
            )

        return value

    @property
    def type_only(self) -> bool:
        value = _read_field(
            self.raw,
            "typeOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Import typeOnly must be a boolean"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def import_clause_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "importClauseStart",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Import importClauseStart must be "
                "an integer or null"
            )

        return value

    @property
    def import_clause_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "importClauseEnd",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Import importClauseEnd must be "
                "an integer or null"
            )

        return value

    @property
    def named_bindings_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "namedBindingsStart",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Import namedBindingsStart must be "
                "an integer or null"
            )

        return value

    @property
    def named_bindings_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "namedBindingsEnd",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Import namedBindingsEnd must be "
                "an integer or null"
            )

        return value

    @property
    def module_specifier_start(self) -> int:
        return _required_integer(
            self.raw,
            "moduleSpecifierStart",
        )

    @property
    def module_specifier_end(self) -> int:
        return _required_integer(
            self.raw,
            "moduleSpecifierEnd",
        )

    def named_imports(
        self,
    ) -> tuple[NamedImportNode, ...]:
        values = _read_field(
            self.raw,
            "namedImports",
            (),
        )

        return tuple(
            NamedImportNode(raw=node)
            for node in _as_node_sequence(
                values,
                "import.namedImports",
            )
        )

    def contains_local(
        self,
        symbol: str,
    ) -> bool:
        return (
            self.default_import == symbol
            or self.namespace_import == symbol
            or any(
                item.local == symbol
                for item in self.named_imports()
            )
        )

    def contains_imported(
        self,
        symbol: str,
    ) -> bool:
        return any(
            item.imported == symbol
            for item in self.named_imports()
        )


@dataclass(frozen=True, slots=True)
class NamedExportNode:
    raw: Any

    @property
    def local(self) -> str:
        value = _read_field(
            self.raw,
            "local",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Named export local name must be "
                "a non-empty string"
            )

        return value

    @property
    def exported(self) -> str:
        value = _read_field(
            self.raw,
            "exported",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Named export exported name must be "
                "a non-empty string"
            )

        return value

    @property
    def type_only(self) -> bool:
        value = _read_field(
            self.raw,
            "typeOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Named export typeOnly must be a boolean"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def aliased(self) -> bool:
        return self.local != self.exported


@dataclass(frozen=True, slots=True)
class RenameOccurrenceNode:
    raw: Any

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def prefix_text(self) -> str:
        value = _read_field(
            self.raw,
            "prefixText",
            "",
        )

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Rename occurrence prefixText "
                "must be a string"
            )

        return value

    @property
    def suffix_text(self) -> str:
        value = _read_field(
            self.raw,
            "suffixText",
            "",
        )

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Rename occurrence suffixText "
                "must be a string"
            )

        return value


@dataclass(frozen=True, slots=True)
class RenameSymbolNode:
    raw: Any

    @property
    def name(self) -> str:
        value = _read_field(
            self.raw,
            "name",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Rename symbol name must be "
                "a non-empty string"
            )

        return value

    @property
    def kind(self) -> str:
        value = _read_field(
            self.raw,
            "kind",
        )

        allowed = {
            "class",
            "function",
            "variable",
            "interface",
            "type",
            "enum",
        }

        if value not in allowed:
            raise InvalidASTStructure(
                "Rename symbol kind is invalid"
            )

        return value

    @property
    def declaration_start(self) -> int:
        return _required_integer(
            self.raw,
            "declarationStart",
        )

    @property
    def declaration_end(self) -> int:
        return _required_integer(
            self.raw,
            "declarationEnd",
        )

    @property
    def identifier_start(self) -> int:
        return _required_integer(
            self.raw,
            "identifierStart",
        )

    @property
    def identifier_end(self) -> int:
        return _required_integer(
            self.raw,
            "identifierEnd",
        )

    @property
    def occurrences(
        self,
    ) -> tuple[RenameOccurrenceNode, ...]:
        values = _read_field(
            self.raw,
            "occurrences",
            (),
        )

        items = _as_node_sequence(
            values,
            "rename_symbol.occurrences",
        )

        return tuple(
            RenameOccurrenceNode(raw=item)
            for item in items
        )


@dataclass(frozen=True, slots=True)
class VariableDeclaratorNode:
    raw: Any

    @property
    def names(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "names",
            (),
        )

        if not isinstance(
            values,
            (list, tuple),
        ):
            raise InvalidASTStructure(
                "Variable declarator names "
                "must be a sequence"
            )

        if not all(
            isinstance(value, str)
            for value in values
        ):
            raise InvalidASTStructure(
                "Variable declarator names "
                "must contain strings"
            )

        return tuple(values)

    def contains_name(
        self,
        name: str,
    ) -> bool:
        return name in self.names

    @property
    def destructuring(self) -> bool:
        value = _read_field(
            self.raw,
            "destructuring",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Variable declarator "
                "destructuring must be a boolean"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def removal_start(self) -> int:
        return _required_integer(
            self.raw,
            "removalStart",
        )

    @property
    def removal_end(self) -> int:
        return _required_integer(
            self.raw,
            "removalEnd",
        )


@dataclass(frozen=True, slots=True)
class ExportedDeclarationNode:
    raw: Any

    @property
    def kind(self) -> str:
        value = _read_field(
            self.raw,
            "kind",
        )

        allowed = {
            "class",
            "function",
            "variable",
            "interface",
            "type",
            "enum",
        }

        if value not in allowed:
            raise InvalidASTStructure(
                "Exported declaration kind must be one "
                "of class, function, variable, "
                "interface, type, or enum"
            )

        return value

    @property
    def name(self) -> str | None:
        value = _read_field(
            self.raw,
            "name",
        )

        if value is None:
            return None

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Exported declaration name must be "
                "a non-empty string or null"
            )

        return value

    @property
    def names(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "names",
            (),
        )

        items = _as_node_sequence(
            values,
            "exported_declaration.names",
        )

        for value in items:
            if not isinstance(value, str) or not value:
                raise InvalidASTStructure(
                    "Exported declaration names must "
                    "contain non-empty strings"
                )

        return tuple(items)

    @property
    def exported(self) -> bool:
        value = _read_field(
            self.raw,
            "exported",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Exported declaration exported must "
                "be a boolean"
            )

        return value

    @property
    def default(self) -> bool:
        value = _read_field(
            self.raw,
            "default",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Exported declaration default must "
                "be a boolean"
            )

        return value

    @property
    def type_only(self) -> bool:
        value = _read_field(
            self.raw,
            "typeOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Exported declaration typeOnly must "
                "be a boolean"
            )

        return value

    @property
    def modifiers(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "modifiers",
            (),
        )

        items = _as_node_sequence(
            values,
            "exported_declaration.modifiers",
        )

        for value in items:
            if not isinstance(value, str) or not value:
                raise InvalidASTStructure(
                    "Exported declaration modifiers "
                    "must contain non-empty strings"
                )

        return tuple(items)

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def start_line(self) -> int:
        return _required_integer(
            self.raw,
            "startLine",
        )

    @property
    def start_column(self) -> int:
        return _required_integer(
            self.raw,
            "startColumn",
        )

    @property
    def end_line(self) -> int:
        return _required_integer(
            self.raw,
            "endLine",
        )

    @property
    def end_column(self) -> int:
        return _required_integer(
            self.raw,
            "endColumn",
        )

    @property
    def modifier_start(self) -> int:
        return _required_integer(
            self.raw,
            "modifierStart",
        )

    @property
    def keyword_start(self) -> int:
        return _required_integer(
            self.raw,
            "keywordStart",
        )

    def _optional_offset(
        self,
        field: str,
    ) -> int | None:
        value = _read_field(
            self.raw,
            field,
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                f"Exported declaration {field} "
                "must be an integer or null"
            )

        return value

    @property
    def export_modifier_start(
        self,
    ) -> int | None:
        return self._optional_offset(
            "exportModifierStart"
        )

    @property
    def export_modifier_end(
        self,
    ) -> int | None:
        return self._optional_offset(
            "exportModifierEnd"
        )

    @property
    def default_modifier_start(
        self,
    ) -> int | None:
        return self._optional_offset(
            "defaultModifierStart"
        )

    @property
    def default_modifier_end(
        self,
    ) -> int | None:
        return self._optional_offset(
            "defaultModifierEnd"
        )

    @property
    def removal_start(self) -> int:
        return _required_integer(
            self.raw,
            "removalStart",
        )

    @property
    def removal_end(self) -> int:
        return _required_integer(
            self.raw,
            "removalEnd",
        )

    @property
    def variable_declarators(
        self,
    ) -> tuple[VariableDeclaratorNode, ...]:
        values = _read_field(
            self.raw,
            "variableDeclarators",
            (),
        )

        items = _as_node_sequence(
            values,
            "declaration.variableDeclarators",
        )

        return tuple(
            VariableDeclaratorNode(raw=item)
            for item in items
        )

    def variable_declarator(
        self,
        name: str,
    ) -> VariableDeclaratorNode | None:
        matches = [
            item
            for item in self.variable_declarators
            if item.contains_name(name)
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one variable declarator "
                f"containing {name!r} was found"
            )

        return matches[0] if matches else None

    @property
    def declaration_start(self) -> int:
        return _required_integer(
            self.raw,
            "declarationStart",
        )

    @property
    def declaration_end(self) -> int:
        return _required_integer(
            self.raw,
            "declarationEnd",
        )

    def contains_name(
        self,
        symbol: str,
    ) -> bool:
        return (
            self.name == symbol
            or symbol in self.names
        )


@dataclass(frozen=True, slots=True)
class ExportNode:
    raw: Any

    @property
    def module(self) -> str | None:
        value = _read_field(
            self.raw,
            "module",
        )

        if value is None:
            return None

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Export module must be a non-empty "
                "string or null"
            )

        return value

    @property
    def quote_style(self) -> str:
        value = _read_field(
            self.raw,
            "quoteStyle",
        )

        if value not in {"'", '"'}:
            raise InvalidASTStructure(
                "Export quoteStyle must be a single "
                "or double quote"
            )

        return value

    @property
    def export_all(self) -> bool:
        value = _read_field(
            self.raw,
            "exportAll",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Export exportAll must be a boolean"
            )

        return value

    @property
    def namespace_export(self) -> str | None:
        value = _read_field(
            self.raw,
            "namespaceExport",
        )

        if value is None:
            return None

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Export namespaceExport must be "
                "a non-empty string or null"
            )

        return value

    @property
    def type_only(self) -> bool:
        value = _read_field(
            self.raw,
            "typeOnly",
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                "Export typeOnly must be a boolean"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def export_clause_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "exportClauseStart",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Export exportClauseStart must be "
                "an integer or null"
            )

        return value

    @property
    def export_clause_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "exportClauseEnd",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Export exportClauseEnd must be "
                "an integer or null"
            )

        return value

    @property
    def module_specifier_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "moduleSpecifierStart",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Export moduleSpecifierStart must be "
                "an integer or null"
            )

        return value

    @property
    def module_specifier_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "moduleSpecifierEnd",
        )

        if value is None:
            return None

        if isinstance(value, bool) or not isinstance(
            value,
            int,
        ):
            raise InvalidASTStructure(
                "Export moduleSpecifierEnd must be "
                "an integer or null"
            )

        return value

    def named_exports(
        self,
    ) -> tuple[NamedExportNode, ...]:
        values = _read_field(
            self.raw,
            "namedExports",
            (),
        )

        return tuple(
            NamedExportNode(raw=node)
            for node in _as_node_sequence(
                values,
                "export.namedExports",
            )
        )

    def contains_local(
        self,
        symbol: str,
    ) -> bool:
        return any(
            item.local == symbol
            for item in self.named_exports()
        )

    def contains_exported(
        self,
        symbol: str,
    ) -> bool:
        return (
            self.namespace_export == symbol
            or any(
                item.exported == symbol
                for item in self.named_exports()
            )
        )


@dataclass(frozen=True, slots=True)
class MemberRenameSymbolNode:
    raw: Any

    @property
    def class_name(self) -> str:
        value = _read_field(
            self.raw,
            "className",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Member rename symbol className "
                "must be a non-empty string"
            )

        return value

    @property
    def name(self) -> str:
        value = _read_field(
            self.raw,
            "name",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Member rename symbol name must "
                "be a non-empty string"
            )

        return value

    @property
    def kind(self) -> str:
        value = _read_field(
            self.raw,
            "kind",
        )

        allowed = {
            "method",
            "property",
            "getter",
            "setter",
        }

        if value not in allowed:
            raise InvalidASTStructure(
                "Member rename symbol kind must be "
                "method, property, getter, or setter"
            )

        return value

    @property
    def declaration_start(self) -> int:
        return _required_integer(
            self.raw,
            "declarationStart",
        )

    @property
    def declaration_end(self) -> int:
        return _required_integer(
            self.raw,
            "declarationEnd",
        )

    @property
    def member_start(self) -> int:
        return _required_integer(
            self.raw,
            "memberStart",
        )

    @property
    def member_end(self) -> int:
        return _required_integer(
            self.raw,
            "memberEnd",
        )

    @property
    def identifier_start(self) -> int:
        return _required_integer(
            self.raw,
            "identifierStart",
        )

    @property
    def identifier_end(self) -> int:
        return _required_integer(
            self.raw,
            "identifierEnd",
        )

    @property
    def occurrences(
        self,
    ) -> tuple[RenameOccurrenceNode, ...]:
        values = _read_field(
            self.raw,
            "occurrences",
            (),
        )

        return tuple(
            RenameOccurrenceNode(raw=node)
            for node in _as_node_sequence(
                values,
                "member rename symbol occurrences",
            )
        )


@dataclass(frozen=True, slots=True)
class ClassMemberNode:
    raw: Any

    @property
    def kind(self) -> str:
        value = _read_field(
            self.raw,
            "kind",
        )

        allowed = {
            "constructor",
            "method",
            "property",
            "getter",
            "setter",
        }

        if value not in allowed:
            raise InvalidASTStructure(
                "Class member kind must be one of "
                "constructor, method, property, "
                "getter, or setter"
            )

        return value

    @property
    def name(self) -> str:
        value = _read_field(
            self.raw,
            "name",
        )

        if not isinstance(value, str) or not value:
            raise InvalidASTStructure(
                "Class member name must be "
                "a non-empty string"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def member_start(self) -> int:
        return _required_integer(
            self.raw,
            "memberStart",
        )

    @property
    def member_end(self) -> int:
        return _required_integer(
            self.raw,
            "memberEnd",
        )

    @property
    def removal_start(self) -> int:
        return _required_integer(
            self.raw,
            "removalStart",
        )

    @property
    def removal_end(self) -> int:
        return _required_integer(
            self.raw,
            "removalEnd",
        )

    @property
    def identifier_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "identifierStart",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class member identifierStart must "
                "be an integer or null"
            )

        return value

    @property
    def identifier_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "identifierEnd",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class member identifierEnd must "
                "be an integer or null"
            )

        return value

    @property
    def visibility(self) -> str:
        value = _read_field(
            self.raw,
            "visibility",
        )

        if value not in {
            "public",
            "protected",
            "private",
        }:
            raise InvalidASTStructure(
                "Class member visibility must be "
                "public, protected, or private"
            )

        return value

    def _boolean(
        self,
        field_name: str,
    ) -> bool:
        value = _read_field(
            self.raw,
            field_name,
            False,
        )

        if not isinstance(value, bool):
            raise InvalidASTStructure(
                f"Class member {field_name} "
                "must be a boolean"
            )

        return value

    @property
    def static(self) -> bool:
        return self._boolean("static")

    @property
    def async_(self) -> bool:
        return self._boolean("async")

    @property
    def abstract(self) -> bool:
        return self._boolean("abstract")

    @property
    def readonly(self) -> bool:
        return self._boolean("readonly")

    @property
    def declare(self) -> bool:
        return self._boolean("declare")

    @property
    def override(self) -> bool:
        return self._boolean("override")

    @property
    def optional(self) -> bool:
        return self._boolean("optional")

    @property
    def computed(self) -> bool:
        return self._boolean("computed")

    @property
    def modifiers(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "modifiers",
            (),
        )

        if values is None:
            return ()

        if isinstance(values, (str, bytes)):
            raise InvalidASTStructure(
                "Class member modifiers must "
                "be a sequence"
            )

        if not isinstance(values, Sequence):
            raise InvalidASTStructure(
                "Class member modifiers must "
                "be a sequence"
            )

        if not all(
            isinstance(item, str)
            for item in values
        ):
            raise InvalidASTStructure(
                "Class member modifiers must "
                "contain only strings"
            )

        return tuple(values)

    @property
    def decorators(self) -> tuple[str, ...]:
        values = _read_field(
            self.raw,
            "decorators",
            (),
        )

        if values is None:
            return ()

        if isinstance(values, (str, bytes)):
            raise InvalidASTStructure(
                "Class member decorators must "
                "be a sequence"
            )

        if not isinstance(values, Sequence):
            raise InvalidASTStructure(
                "Class member decorators must "
                "be a sequence"
            )

        if not all(
            isinstance(item, str)
            for item in values
        ):
            raise InvalidASTStructure(
                "Class member decorators must "
                "contain only strings"
            )

        return tuple(values)

    @property
    def parameters(
        self,
    ) -> tuple[ParameterNode, ...]:
        values = _read_field(
            self.raw,
            "parameters",
            (),
        )

        return tuple(
            ParameterNode(raw=item)
            for item in _as_node_sequence(
                values,
                "class_member.parameters",
            )
        )

    @property
    def parameter_count(self) -> int:
        value = _read_field(
            self.raw,
            "parameterCount",
            len(self.parameters),
        )

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < 0
        ):
            raise InvalidASTStructure(
                "Class member parameterCount must "
                "be a non-negative integer"
            )

        return value

    @property
    def return_type(self) -> str | None:
        value = _read_field(
            self.raw,
            "returnType",
        )

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Class member returnType must "
                "be a string or null"
            )

        return value

    @property
    def type(self) -> str | None:
        value = _read_field(
            self.raw,
            "type",
        )

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Class member type must be "
                "a string or null"
            )

        return value

    @property
    def initializer(self) -> str | None:
        value = _read_field(
            self.raw,
            "initializer",
        )

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Class member initializer must "
                "be a string or null"
            )

        return value

    @property
    def body_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "bodyStart",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class member bodyStart must "
                "be an integer or null"
            )

        return value

    @property
    def body_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "bodyEnd",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class member bodyEnd must "
                "be an integer or null"
            )

        return value


@dataclass(frozen=True, slots=True)
class ClassNode:
    raw: Any

    @property
    def name(self) -> str | None:
        value = _read_field(self.raw, "name")

        if value is None:
            return None

        if not isinstance(value, str):
            raise InvalidASTStructure(
                "Class name must be a string"
            )

        return value

    @property
    def start(self) -> int:
        return _required_integer(
            self.raw,
            "start",
        )

    @property
    def end(self) -> int:
        return _required_integer(
            self.raw,
            "end",
        )

    @property
    def class_start(self) -> int:
        return _required_integer(
            self.raw,
            "classStart",
        )

    @property
    def class_end(self) -> int:
        return _required_integer(
            self.raw,
            "classEnd",
        )

    @property
    def identifier_start(self) -> int | None:
        value = _read_field(
            self.raw,
            "identifierStart",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class identifierStart must be "
                "an integer or null"
            )

        return value

    @property
    def identifier_end(self) -> int | None:
        value = _read_field(
            self.raw,
            "identifierEnd",
        )

        if value is None:
            return None

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
        ):
            raise InvalidASTStructure(
                "Class identifierEnd must be "
                "an integer or null"
            )

        return value

    @property
    def member_count(self) -> int:
        value = _read_field(
            self.raw,
            "memberCount",
            len(self.members()),
        )

        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < 0
        ):
            raise InvalidASTStructure(
                "Class memberCount must be "
                "a non-negative integer"
            )

        return value

    def members(
        self,
    ) -> tuple[ClassMemberNode, ...]:
        values = _read_field(
            self.raw,
            "members",
            (),
        )

        return tuple(
            ClassMemberNode(raw=item)
            for item in _as_node_sequence(
                values,
                "class.members",
            )
        )

    def iter_members(
        self,
    ) -> Iterator[ClassMemberNode]:
        return iter(self.members())

    def members_of_kind(
        self,
        kind: str,
    ) -> tuple[ClassMemberNode, ...]:
        if not isinstance(kind, str):
            raise TypeError(
                "kind must be a string"
            )

        normalized = kind.strip()

        allowed = {
            "constructor",
            "method",
            "property",
            "getter",
            "setter",
        }

        if normalized not in allowed:
            raise ValueError(
                "kind must be one of constructor, "
                "method, property, getter, or setter"
            )

        return tuple(
            member
            for member in self.members()
            if member.kind == normalized
        )

    def member(
        self,
        name: str,
        *,
        kind: str | None = None,
        required: bool = True,
    ) -> ClassMemberNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError(
                "name cannot be empty"
            )

        normalized_kind: str | None = None

        if kind is not None:
            if not isinstance(kind, str):
                raise TypeError(
                    "kind must be a string or None"
                )

            normalized_kind = kind.strip()

            allowed = {
                "constructor",
                "method",
                "property",
                "getter",
                "setter",
            }

            if normalized_kind not in allowed:
                raise ValueError(
                    "kind must be one of constructor, "
                    "method, property, getter, or setter"
                )

        matches = [
            member
            for member in self.members()
            if (
                member.name == normalized_name
                and (
                    normalized_kind is None
                    or member.kind
                    == normalized_kind
                )
            )
        ]

        if len(matches) > 1:
            kind_description = (
                f" of kind {normalized_kind!r}"
                if normalized_kind is not None
                else ""
            )

            raise ASTNodeAmbiguous(
                f"Class {self.name!r} contains more "
                f"than one member named "
                f"{normalized_name!r}"
                f"{kind_description}"
            )

        if matches:
            return matches[0]

        if required:
            kind_description = (
                f" of kind {normalized_kind!r}"
                if normalized_kind is not None
                else ""
            )

            raise ASTNodeNotFound(
                f"Class {self.name!r} does not "
                f"contain a member named "
                f"{normalized_name!r}"
                f"{kind_description}"
            )

        return None

    def has_member(
        self,
        name: str,
        *,
        kind: str | None = None,
    ) -> bool:
        return (
            self.member(
                name,
                kind=kind,
                required=False,
            )
            is not None
        )

    def constructors(
        self,
    ) -> tuple[ConstructorNode, ...]:
        values = _read_field(
            self.raw,
            "constructors",
            (),
        )

        return tuple(
            ConstructorNode(raw=node)
            for node in _as_node_sequence(
                values,
                "class.constructors",
            )
        )

    def constructor(
        self,
        *,
        required: bool = True,
    ) -> ConstructorNode | None:
        constructors = self.constructors()

        if len(constructors) > 1:
            raise ASTNodeAmbiguous(
                f"Class {self.name!r} contains more than "
                "one constructor"
            )

        if constructors:
            return constructors[0]

        if required:
            raise ASTNodeNotFound(
                f"Class {self.name!r} does not contain "
                "a constructor"
            )

        return None

    def has_constructor(self) -> bool:
        return (
            self.constructor(required=False)
            is not None
        )


class ASTNavigator:
    """
    Read-only navigator for TypeScriptBridge output.

    Example:

        navigator = ASTNavigator(result)

        constructor = (
            navigator
            .class_("AppService")
            .constructor()
        )

        last_parameter = constructor.last_parameter()
    """

    def __init__(
        self,
        bridge_result: Any,
    ) -> None:
        if bridge_result is None:
            raise TypeError(
                "bridge_result cannot be None"
            )

        self.bridge_result = bridge_result

    def _import_values(self) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "imports",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.imports",
        )

    def imports(self) -> tuple[ImportNode, ...]:
        return tuple(
            ImportNode(raw=node)
            for node in self._import_values()
        )

    def iter_imports(self) -> Iterator[ImportNode]:
        return iter(self.imports())

    def imports_from(
        self,
        module: str,
    ) -> tuple[ImportNode, ...]:
        if not isinstance(module, str):
            raise TypeError(
                "module must be a string"
            )

        normalized = module.strip()

        if not normalized:
            raise ValueError(
                "module cannot be empty"
            )

        return tuple(
            node
            for node in self.imports()
            if node.module == normalized
        )

    def import_from(
        self,
        module: str,
        *,
        required: bool = True,
    ) -> ImportNode | None:
        matches = self.imports_from(module)

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one import from "
                f"{module!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"No import from {module!r} was found"
            )

        return None

    def has_local_import(
        self,
        symbol: str,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        normalized = symbol.strip()

        if not normalized:
            raise ValueError(
                "symbol cannot be empty"
            )

        return any(
            node.contains_local(normalized)
            for node in self.imports()
        )

    def _export_values(self) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "exports",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.exports",
        )

    def exports(self) -> tuple[ExportNode, ...]:
        return tuple(
            ExportNode(raw=node)
            for node in self._export_values()
        )

    def iter_exports(self) -> Iterator[ExportNode]:
        return iter(self.exports())

    def exports_from(
        self,
        module: str,
    ) -> tuple[ExportNode, ...]:
        if not isinstance(module, str):
            raise TypeError(
                "module must be a string"
            )

        normalized = module.strip()

        if not normalized:
            raise ValueError(
                "module cannot be empty"
            )

        return tuple(
            node
            for node in self.exports()
            if node.module == normalized
        )

    def export_from(
        self,
        module: str,
        *,
        required: bool = True,
    ) -> ExportNode | None:
        matches = self.exports_from(module)

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one export from "
                f"{module!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"No export from {module!r} was found"
            )

        return None

    def local_exports(
        self,
    ) -> tuple[ExportNode, ...]:
        return tuple(
            node
            for node in self.exports()
            if node.module is None
        )

    def has_exported_symbol(
        self,
        symbol: str,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        normalized = symbol.strip()

        if not normalized:
            raise ValueError(
                "symbol cannot be empty"
            )

        return any(
            node.contains_exported(normalized)
            for node in self.exports()
        )

    def _rename_symbol_values(
        self,
    ) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "rename_symbols",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.rename_symbols",
        )

    def rename_symbols(
        self,
    ) -> tuple[RenameSymbolNode, ...]:
        return tuple(
            RenameSymbolNode(raw=node)
            for node in self._rename_symbol_values()
        )

    def iter_rename_symbols(
        self,
    ) -> Iterator[RenameSymbolNode]:
        return iter(
            self.rename_symbols()
        )

    def rename_symbol(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> RenameSymbolNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "name cannot be empty"
            )

        matches = [
            node
            for node in self.rename_symbols()
            if node.name == normalized
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one rename symbol "
                f"named {normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"No rename symbol named "
                f"{normalized!r} was found"
            )

        return None

    def has_rename_symbol(
        self,
        name: str,
    ) -> bool:
        return (
            self.rename_symbol(
                name,
                required=False,
            )
            is not None
        )

    def _member_rename_symbol_values(
        self,
    ) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "member_rename_symbols",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.member_rename_symbols",
        )

    def member_rename_symbols(
        self,
    ) -> tuple[
        MemberRenameSymbolNode,
        ...,
    ]:
        return tuple(
            MemberRenameSymbolNode(raw=node)
            for node
            in self._member_rename_symbol_values()
        )

    def iter_member_rename_symbols(
        self,
    ) -> Iterator[
        MemberRenameSymbolNode
    ]:
        return iter(
            self.member_rename_symbols()
        )

    def member_rename_symbol(
        self,
        class_name: str,
        member_name: str,
        *,
        kind: str | None = None,
        required: bool = True,
    ) -> MemberRenameSymbolNode | None:
        if not isinstance(
            class_name,
            str,
        ):
            raise TypeError(
                "class_name must be a string"
            )

        if not isinstance(
            member_name,
            str,
        ):
            raise TypeError(
                "member_name must be a string"
            )

        if (
            kind is not None
            and not isinstance(kind, str)
        ):
            raise TypeError(
                "kind must be a string or None"
            )

        normalized_class = (
            class_name.strip()
        )
        normalized_member = (
            member_name.strip()
        )
        normalized_kind = (
            kind.strip()
            if isinstance(kind, str)
            else None
        )

        if not normalized_class:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not normalized_member:
            raise ValueError(
                "member_name cannot be empty"
            )

        allowed_kinds = {
            "method",
            "property",
            "getter",
            "setter",
        }

        if (
            normalized_kind is not None
            and normalized_kind
            not in allowed_kinds
        ):
            raise ValueError(
                "kind must be method, property, "
                "getter, or setter"
            )

        matches = [
            node
            for node
            in self.member_rename_symbols()
            if (
                node.class_name
                == normalized_class
                and node.name
                == normalized_member
                and (
                    normalized_kind is None
                    or node.kind
                    == normalized_kind
                )
            )
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"Class {normalized_class!r} "
                f"contains more than one "
                f"renameable member named "
                f"{normalized_member!r}"
            )

        if matches:
            return matches[0]

        if required:
            kind_text = (
                f" of kind {normalized_kind!r}"
                if normalized_kind
                else ""
            )

            raise ASTNodeNotFound(
                f"No renameable member named "
                f"{normalized_member!r}"
                f"{kind_text} was found in class "
                f"{normalized_class!r}"
            )

        return None

    def has_member_rename_symbol(
        self,
        class_name: str,
        member_name: str,
        *,
        kind: str | None = None,
    ) -> bool:
        return (
            self.member_rename_symbol(
                class_name,
                member_name,
                kind=kind,
                required=False,
            )
            is not None
        )

    def class_node(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> ClassNode | None:
        return self.class_(
            name,
            required=required,
        )

    def class_member(
        self,
        class_name: str,
        member_name: str,
        *,
        kind: str | None = None,
        required: bool = True,
    ) -> ClassMemberNode | None:
        class_node = self.class_(
            class_name,
            required=required,
        )

        if class_node is None:
            return None

        return class_node.member(
            member_name,
            kind=kind,
            required=required,
        )

    def _declaration_values(
        self,
    ) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "declarations",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.declarations",
        )

    def declarations(
        self,
    ) -> tuple[ExportedDeclarationNode, ...]:
        """
        Return all supported top-level declarations.

        Despite the historical node class name, these nodes may
        represent either exported or non-exported declarations.
        Use node.exported to distinguish them.
        """

        return tuple(
            ExportedDeclarationNode(raw=node)
            for node in self._declaration_values()
        )

    def iter_declarations(
        self,
    ) -> Iterator[ExportedDeclarationNode]:
        return iter(
            self.declarations()
        )

    def declarations_of_kind(
        self,
        kind: str,
    ) -> tuple[ExportedDeclarationNode, ...]:
        if not isinstance(kind, str):
            raise TypeError(
                "kind must be a string"
            )

        normalized = kind.strip()

        if not normalized:
            raise ValueError(
                "kind cannot be empty"
            )

        allowed = {
            "class",
            "function",
            "variable",
            "interface",
            "type",
            "enum",
        }

        if normalized not in allowed:
            raise ValueError(
                "kind must be one of class, function, "
                "variable, interface, type, or enum"
            )

        return tuple(
            node
            for node in self.declarations()
            if node.kind == normalized
        )

    def declaration(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> ExportedDeclarationNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "name cannot be empty"
            )

        matches = [
            node
            for node in self.declarations()
            if node.contains_name(normalized)
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one declaration "
                f"containing {normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"No declaration containing "
                f"{normalized!r} was found"
            )

        return None

    def has_declaration(
        self,
        name: str,
    ) -> bool:
        return (
            self.declaration(
                name,
                required=False,
            )
            is not None
        )

    def _exported_declaration_values(
        self,
    ) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "exported_declarations",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.exported_declarations",
        )

    def exported_declarations(
        self,
    ) -> tuple[ExportedDeclarationNode, ...]:
        return tuple(
            ExportedDeclarationNode(raw=node)
            for node in (
                self._exported_declaration_values()
            )
        )

    def iter_exported_declarations(
        self,
    ) -> Iterator[ExportedDeclarationNode]:
        return iter(
            self.exported_declarations()
        )

    def exported_declarations_of_kind(
        self,
        kind: str,
    ) -> tuple[ExportedDeclarationNode, ...]:
        if not isinstance(kind, str):
            raise TypeError(
                "kind must be a string"
            )

        normalized = kind.strip()

        if not normalized:
            raise ValueError(
                "kind cannot be empty"
            )

        allowed = {
            "class",
            "function",
            "variable",
            "interface",
            "type",
            "enum",
        }

        if normalized not in allowed:
            raise ValueError(
                "kind must be one of class, function, "
                "variable, interface, type, or enum"
            )

        return tuple(
            node
            for node in self.exported_declarations()
            if node.kind == normalized
        )

    def exported_declaration(
        self,
        name: str,
        *,
        required: bool = True,
    ) -> ExportedDeclarationNode | None:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "name cannot be empty"
            )

        matches = [
            node
            for node in self.exported_declarations()
            if node.contains_name(normalized)
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one exported declaration "
                f"containing {normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"No exported declaration containing "
                f"{normalized!r} was found"
            )

        return None

    def default_exported_declaration(
        self,
        *,
        required: bool = True,
    ) -> ExportedDeclarationNode | None:
        matches = [
            node
            for node in self.exported_declarations()
            if node.default
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                "More than one default exported "
                "declaration was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                "No default exported declaration "
                "was found"
            )

        return None

    def has_exported_declaration(
        self,
        name: str,
    ) -> bool:
        return (
            self.exported_declaration(
                name,
                required=False,
            )
            is not None
        )

    def _class_values(self) -> tuple[Any, ...]:
        values = _read_field(
            self.bridge_result,
            "classes",
            (),
        )

        return _as_node_sequence(
            values,
            "bridge_result.classes",
        )

    def classes(self) -> tuple[ClassNode, ...]:
        return tuple(
            ClassNode(raw=node)
            for node in self._class_values()
        )

    def iter_classes(self) -> Iterator[ClassNode]:
        return iter(self.classes())

    def class_(
        self,
        name: str | None = None,
        *,
        required: bool = True,
    ) -> ClassNode | None:
        """
        Locate a class by name.

        When name is None, the result must contain exactly one class.
        This is convenient for single-class TypeScript files.
        """

        classes = self.classes()

        if name is None:
            if len(classes) > 1:
                raise ASTNodeAmbiguous(
                    "More than one class exists; "
                    "provide a class name"
                )

            if classes:
                return classes[0]

            if required:
                raise ASTNodeNotFound(
                    "No TypeScript class was found"
                )

            return None

        if not isinstance(name, str):
            raise TypeError(
                "class name must be a string or None"
            )

        normalized = name.strip()

        if not normalized:
            raise ValueError(
                "class name cannot be empty"
            )

        matches = [
            class_node
            for class_node in classes
            if class_node.name == normalized
        ]

        if len(matches) > 1:
            raise ASTNodeAmbiguous(
                f"More than one class named "
                f"{normalized!r} was found"
            )

        if matches:
            return matches[0]

        if required:
            raise ASTNodeNotFound(
                f"TypeScript class "
                f"{normalized!r} was not found"
            )

        return None

    def has_class(
        self,
        name: str,
    ) -> bool:
        return (
            self.class_(
                name,
                required=False,
            )
            is not None
        )
