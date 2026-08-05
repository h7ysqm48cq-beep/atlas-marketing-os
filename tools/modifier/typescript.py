from __future__ import annotations

from .export_insertion import (
    DuplicateExportSymbol,
    ExportInsertionContext,
    ExportInsertionPlanner,
    InvalidExportInsertion,
)

import re
from dataclasses import dataclass, field
from pathlib import Path

from .ast_navigator import ASTNavigator
from .bridge import TypeScriptBridge
from .bridge_editor import BridgeEditor
from .variable_update import (
    InvalidVariableUpdate,
    VariableUpdateContext,
    VariableUpdateError,
    VariableUpdatePlanner,
)
from .enum_update import (
    EnumUpdateContext,
    EnumUpdateError,
    EnumUpdatePlanner,
    InvalidEnumUpdate,
)
from .type_alias_update import (
    InvalidTypeAliasUpdate,
    TypeAliasUpdateContext,
    TypeAliasUpdateError,
    TypeAliasUpdatePlanner,
)
from .interface_update import (
    InterfaceUpdateContext,
    InterfaceUpdateError,
    InterfaceUpdatePlanner,
    InvalidInterfaceUpdate,
)
from .function_update import (
    FunctionUpdateContext,
    FunctionUpdateError,
    FunctionUpdatePlanner,
    InvalidFunctionUpdate,
)
from .class_update import (
    ClassUpdateContext,
    ClassUpdateError,
    ClassUpdatePlanner,
    InvalidClassUpdate,
)
from .declaration_add import (
    DeclarationAddConflict,
    DeclarationAddContext,
    DeclarationAddError,
    DeclarationAddPlanner,
    InvalidDeclarationAdd,
)
from .declaration_move import (
    DeclarationMoveContext,
    DeclarationMoveError,
    DeclarationMovePlanner,
)

from .declaration_removal import (
    DeclarationRemovalContext,
    DeclarationRemovalError,
    DeclarationRemovalPlanner,
)

from .declaration_rename import (
    DeclarationRenameConflict,
    DeclarationRenameContext,
    DeclarationRenameError,
    DeclarationRenamePlanner,
    InvalidDeclarationName,
)

from .member_add import (
    InvalidMemberAdd,
    MemberAddConflict,
    MemberAddContext,
    MemberAddError,
    MemberAddPlanner,
)
from .member_update import (
    InvalidMemberUpdate,
    MemberUpdateContext,
    MemberUpdateError,
    MemberUpdatePlanner,
)
from .member_move import (
    InvalidMemberMove,
    MemberMoveContext,
    MemberMoveError,
    MemberMovePlanner,
    UnsupportedMemberMove,
)
from .member_rename import (
    InvalidMemberName,
    MemberRenameConflict,
    MemberRenameContext,
    MemberRenameError,
    MemberRenamePlanner,
)

from .member_removal import (
    MemberRemovalContext,
    MemberRemovalError,
    MemberRemovalPlanner,
)

from .declaration_export_modifier import (
    DeclarationExportContext,
    DeclarationExportPlanner,
    InvalidDeclarationExport,
)

from .default_import_insertion import (
    DefaultImportConflict,
    DefaultImportInsertionContext,
    DefaultImportInsertionPlanner,
    DuplicateDefaultImport,
)
from .exceptions import InvalidTypeScriptFile, UnsupportedTypeScriptImport
from .import_insertion import (
    DuplicateImportSymbol,
    ImportInsertionContext,
    ImportInsertionPlanner,
    UnsupportedImportShape,
)
from .import_removal import (
    ImportRemovalAmbiguous,
    ImportRemovalContext,
    ImportRemovalNotFound,
    ImportRemovalPlanner,
)
from .export_removal import (
    ExportRemovalAmbiguous,
    ExportRemovalContext,
    ExportRemovalNotFound,
    ExportRemovalPlanner,
)


IMPORT_PATTERN = re.compile(
    r"""
    ^import\s+
    (?P<clause>.*?)
    \s+from\s+
    (?P<quote>['"])
    (?P<module>[^'"]+)
    (?P=quote)
    \s*;?
    $
    """,
    re.MULTILINE | re.DOTALL | re.VERBOSE,
)

SIDE_EFFECT_IMPORT_PATTERN = re.compile(
    r"""^import\s+(?P<quote>['"])(?P<module>[^'"]+)(?P=quote)\s*;?$""",
    re.MULTILINE,
)


@dataclass
class ImportStatement:
    module: str
    symbols: list[str] = field(default_factory=list)
    default: str | None = None
    namespace: str | None = None
    side_effect_only: bool = False

    def contains(self, symbol: str) -> bool:
        return (
            symbol == self.default
            or symbol == self.namespace
            or symbol in self.symbols
        )

    def is_empty(self) -> bool:
        return (
            not self.side_effect_only
            and self.default is None
            and self.namespace is None
            and not self.symbols
        )

    def render(self) -> str:
        if self.side_effect_only:
            return f"import '{self.module}';"

        parts: list[str] = []

        if self.default:
            parts.append(self.default)

        if self.namespace:
            parts.append(f"* as {self.namespace}")

        if self.symbols:
            named = ", ".join(sorted(dict.fromkeys(self.symbols)))
            parts.append(f"{{ {named} }}")

        if not parts:
            raise UnsupportedTypeScriptImport(
                f"Cannot render empty import from {self.module!r}"
            )

        return f"import {', '.join(parts)} from '{self.module}';"


class TypeScriptFile:
    """Safe first-generation TypeScript import modifier."""

    def __init__(
        self,
        path: Path,
        text: str,
        imports: list[ImportStatement],
        body: str,
    ) -> None:
        self.path = path
        self._original_text = text
        self._current_text = text
        self._imports = imports
        self._body = body
        self._ast_import_edits_active = False
        self._bridge = TypeScriptBridge()
        self.operations: list[dict[str, object]] = []
        self.dirty = False

    @classmethod
    def load(cls, path: str | Path) -> "TypeScriptFile":
        resolved = Path(path)

        if resolved.suffix not in {".ts", ".tsx"}:
            raise InvalidTypeScriptFile(
                f"Expected a .ts or .tsx file: {resolved}"
            )

        if not resolved.exists():
            raise FileNotFoundError(resolved)

        text = resolved.read_text(encoding="utf-8")
        imports, body = cls._parse_source(text)

        return cls(
            path=resolved,
            text=text,
            imports=imports,
            body=body,
        )

    @staticmethod
    def _split_import_blocks(text: str) -> tuple[list[str], str]:
        lines = text.splitlines(keepends=True)
        blocks: list[str] = []

        index = 0
        current: list[str] = []
        collecting = False
        brace_depth = 0

        while index < len(lines):
            line = lines[index]
            stripped = line.strip()

            if not collecting:
                if stripped == "":
                    index += 1
                    continue

                if not stripped.startswith("import "):
                    break

                collecting = True
                current = [line]
                brace_depth = line.count("{") - line.count("}")

                if (
                    brace_depth <= 0
                    and (
                        stripped.endswith(";")
                        or SIDE_EFFECT_IMPORT_PATTERN.match(stripped)
                    )
                ):
                    blocks.append("".join(current).strip())
                    collecting = False
                    current = []
            else:
                current.append(line)
                brace_depth += line.count("{") - line.count("}")

                if brace_depth <= 0 and stripped.endswith(";"):
                    blocks.append("".join(current).strip())
                    collecting = False
                    current = []

            index += 1

        if collecting:
            raise UnsupportedTypeScriptImport(
                "Unterminated TypeScript import statement"
            )

        body = "".join(lines[index:]).lstrip("\n")
        return blocks, body

    @classmethod
    def _parse_source(
        cls,
        text: str,
    ) -> tuple[list[ImportStatement], str]:
        blocks, body = cls._split_import_blocks(text)
        imports = [cls._parse_import(block) for block in blocks]
        return imports, body

    @staticmethod
    def _parse_import(block: str) -> ImportStatement:
        normalized = re.sub(r"\s+", " ", block).strip()

        side_effect = SIDE_EFFECT_IMPORT_PATTERN.fullmatch(normalized)
        if side_effect:
            return ImportStatement(
                module=side_effect.group("module"),
                side_effect_only=True,
            )

        match = IMPORT_PATTERN.fullmatch(normalized)
        if not match:
            raise UnsupportedTypeScriptImport(
                f"Unsupported import syntax: {block}"
            )

        clause = match.group("clause").strip()
        module = match.group("module")

        default: str | None = None
        namespace: str | None = None
        symbols: list[str] = []

        named_match = re.search(r"\{(?P<symbols>.*?)\}", clause)
        if named_match:
            symbols = [
                symbol.strip()
                for symbol in named_match.group("symbols").split(",")
                if symbol.strip()
            ]
            clause = (
                clause[: named_match.start()]
                + clause[named_match.end() :]
            ).strip().strip(",")

        namespace_match = re.search(
            r"\*\s+as\s+(?P<namespace>[A-Za-z_$][\w$]*)",
            clause,
        )
        if namespace_match:
            namespace = namespace_match.group("namespace")
            clause = (
                clause[: namespace_match.start()]
                + clause[namespace_match.end() :]
            ).strip().strip(",")

        if clause:
            default_candidate = clause.strip().strip(",").strip()
            if "," in default_candidate or " " in default_candidate:
                raise UnsupportedTypeScriptImport(
                    f"Unsupported import clause: {block}"
                )
            default = default_candidate

        return ImportStatement(
            module=module,
            symbols=symbols,
            default=default,
            namespace=namespace,
        )

    def source(self) -> str:
        """
        Return the exact current in-memory source.

        TypeScript AST import edits operate directly on
        source ranges, so this method must not re-render
        parsed import models.
        """
        return self._current_text

    def list_imports(self) -> list[ImportStatement]:
        return [
            ImportStatement(
                module=item.module,
                symbols=list(item.symbols),
                default=item.default,
                namespace=item.namespace,
                side_effect_only=item.side_effect_only,
            )
            for item in self._imports
        ]

    def has_import(
        self,
        symbol: str,
        from_module: str | None = None,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        if not symbol.strip():
            raise ValueError(
                "symbol cannot be empty"
            )

        result = self._bridge.parse_source(
            self.source(),
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        for node in navigator.imports():
            if (
                from_module is not None
                and node.module != from_module
            ):
                continue

            if node.contains_local(symbol):
                return True

            if node.contains_imported(symbol):
                return True

        return False

    def add_import(
        self,
        symbol: str,
        from_module: str,
        *,
        default: bool = False,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        if not isinstance(from_module, str):
            raise TypeError(
                "from_module must be a string"
            )

        if not isinstance(default, bool):
            raise TypeError(
                "default must be a boolean"
            )

        symbol = symbol.strip()
        from_module = from_module.strip()

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        if not from_module:
            raise ValueError(
                "from_module cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)
        imports = navigator.imports()

        for node in imports:
            if node.module != from_module:
                continue

            if default:
                if node.default_import == symbol:
                    return False
            else:
                if (
                    node.contains_imported(symbol)
                    or node.contains_local(symbol)
                ):
                    return False

        quote_style = "'"

        matching_imports = (
            navigator.imports_from(
                from_module
            )
        )

        module_import = (
            matching_imports[0]
            if matching_imports
            else None
        )

        if module_import is not None:
            quote_style = (
                module_import.quote_style
            )
        elif imports:
            quote_style = imports[0].quote_style

        try:
            if default:
                plan = (
                    DefaultImportInsertionPlanner()
                    .plan(
                        DefaultImportInsertionContext(
                            source=current_source,
                            module=from_module,
                            symbol=symbol,
                            imports=imports,
                            quote_style=quote_style,
                        )
                    )
                )
            else:
                plan = ImportInsertionPlanner().plan(
                    ImportInsertionContext(
                        source=current_source,
                        module=from_module,
                        symbol=symbol,
                        imports=imports,
                        quote_style=quote_style,
                    )
                )
        except (
            DefaultImportConflict,
            DuplicateDefaultImport,
            DuplicateImportSymbol,
            UnsupportedImportShape,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        editor.replace(
            plan.start,
            plan.end,
            plan.text,
        )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "add_import",
                "symbol": symbol,
                "module": from_module,
                "default": default,
                "engine": "typescript_ast",
                "shape": plan.shape.value,
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def remove_import(
        self,
        symbol: str,
        from_module: str | None = None,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        if (
            from_module is not None
            and not isinstance(
                from_module,
                str,
            )
        ):
            raise TypeError(
                "from_module must be a string "
                "or None"
            )

        symbol = symbol.strip()

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        if from_module is not None:
            from_module = (
                from_module.strip()
            )

            if not from_module:
                raise ValueError(
                    "from_module cannot be empty"
                )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)
        imports = navigator.imports()

        modules: list[str]

        if from_module is not None:
            modules = [from_module]
        else:
            modules = []

            for node in imports:
                matched = False

                if (
                    node.default_import
                    == symbol
                ):
                    matched = True

                if (
                    node.namespace_import
                    == symbol
                ):
                    matched = True

                if (
                    node.contains_local(
                        symbol
                    )
                    or node.contains_imported(
                        symbol
                    )
                ):
                    matched = True

                if matched:
                    modules.append(
                        node.module
                    )

            modules = list(
                dict.fromkeys(
                    modules
                )
            )

            if not modules:
                return False

            if len(modules) > 1:
                raise UnsupportedTypeScriptImport(
                    f"Import symbol "
                    f"{symbol!r} exists in "
                    f"multiple modules: "
                    f"{modules!r}"
                )

        try:
            plan = (
                ImportRemovalPlanner()
                .plan(
                    ImportRemovalContext(
                        source=current_source,
                        module=modules[0],
                        symbol=symbol,
                        imports=imports,
                    )
                )
            )
        except ImportRemovalNotFound:
            return False
        except ImportRemovalAmbiguous as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        editor.replace(
            plan.start,
            plan.end,
            plan.text,
        )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "remove_import",
                "symbol": symbol,
                "module": modules[0],
                "engine": "typescript_ast",
                "shape": plan.shape.value,
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def _insert_export(
        self,
        *,
        symbol: str | None = None,
        from_module: str | None = None,
        exported_as: str | None = None,
        type_only: bool = False,
        export_all: bool = False,
        namespace_export: str | None = None,
    ) -> bool:
        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        exports = navigator.exports()
        imports = navigator.imports()

        quote_style = "'"

        matching_export = next(
            (
                node
                for node in exports
                if (
                    from_module is not None
                    and node.module == from_module
                )
            ),
            None,
        )

        matching_import = next(
            (
                node
                for node in imports
                if (
                    from_module is not None
                    and node.module == from_module
                )
            ),
            None,
        )

        if matching_export is not None:
            quote_style = (
                matching_export.quote_style
            )
        elif matching_import is not None:
            quote_style = (
                matching_import.quote_style
            )
        elif exports:
            quote_style = exports[0].quote_style
        elif imports:
            quote_style = imports[0].quote_style

        try:
            plan = ExportInsertionPlanner().plan(
                ExportInsertionContext(
                    source=current_source,
                    exports=exports,
                    imports=imports,
                    symbol=symbol,
                    module=from_module,
                    exported_as=exported_as,
                    type_only=type_only,
                    export_all=export_all,
                    namespace_export=(
                        namespace_export
                    ),
                    quote_style=quote_style,
                )
            )
        except DuplicateExportSymbol:
            return False
        except InvalidExportInsertion as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        editor.replace(
            plan.start,
            plan.end,
            plan.text,
        )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        operation: dict[str, object] = {
            "action": "add_export",
            "symbol": symbol,
            "module": from_module,
            "exported_as": exported_as,
            "type_only": type_only,
            "export_all": export_all,
            "namespace_export": (
                namespace_export
            ),
            "engine": "typescript_ast",
            "shape": plan.shape.value,
        }

        self.operations.append(
            operation
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def add_export(
        self,
        symbol: str,
        from_module: str | None = None,
        *,
        exported_as: str | None = None,
        type_only: bool = False,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        symbol = symbol.strip()

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        if (
            from_module is not None
            and not isinstance(
                from_module,
                str,
            )
        ):
            raise TypeError(
                "from_module must be a string "
                "or None"
            )

        if from_module is not None:
            from_module = (
                from_module.strip()
            )

            if not from_module:
                raise ValueError(
                    "from_module cannot be empty"
                )

        if (
            exported_as is not None
            and not isinstance(
                exported_as,
                str,
            )
        ):
            raise TypeError(
                "exported_as must be a string "
                "or None"
            )

        if exported_as is not None:
            exported_as = (
                exported_as.strip()
            )

            if not exported_as:
                raise ValueError(
                    "exported_as cannot be empty"
                )

        if not isinstance(type_only, bool):
            raise TypeError(
                "type_only must be a boolean"
            )

        return self._insert_export(
            symbol=symbol,
            from_module=from_module,
            exported_as=exported_as,
            type_only=type_only,
        )

    def add_export_all(
        self,
        from_module: str,
    ) -> bool:
        if not isinstance(from_module, str):
            raise TypeError(
                "from_module must be a string"
            )

        from_module = from_module.strip()

        if not from_module:
            raise ValueError(
                "from_module cannot be empty"
            )

        return self._insert_export(
            from_module=from_module,
            export_all=True,
        )

    def add_namespace_export(
        self,
        namespace: str,
        from_module: str,
    ) -> bool:
        if not isinstance(namespace, str):
            raise TypeError(
                "namespace must be a string"
            )

        if not isinstance(from_module, str):
            raise TypeError(
                "from_module must be a string"
            )

        namespace = namespace.strip()
        from_module = from_module.strip()

        if not namespace:
            raise ValueError(
                "namespace cannot be empty"
            )

        if not from_module:
            raise ValueError(
                "from_module cannot be empty"
            )

        return self._insert_export(
            from_module=from_module,
            namespace_export=namespace,
        )

    def update_member(
        self,
        class_name: str,
        member_name: str,
        replacement_text: str,
        *,
        kind: str | None = None,
    ) -> bool:
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

        if not isinstance(
            replacement_text,
            str,
        ):
            raise TypeError(
                "replacement_text must be "
                "a string"
            )

        if (
            kind is not None
            and not isinstance(kind, str)
        ):
            raise TypeError(
                "kind must be a string or None"
            )

        class_name = class_name.strip()
        member_name = member_name.strip()

        replacement_text = (
            replacement_text
            .strip("\r\n")
        )

        kind = (
            kind.strip()
            if isinstance(kind, str)
            else None
        )

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not member_name:
            raise ValueError(
                "member_name cannot be empty"
            )

        if not replacement_text.strip():
            raise ValueError(
                "replacement_text cannot be empty"
            )

        if kind == "":
            raise ValueError(
                "kind cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        class_node = navigator.class_(
            class_name,
            required=False,
        )

        if class_node is None:
            return False

        try:
            member = class_node.member(
                member_name,
                kind=kind,
                required=False,
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if member is None:
            return False

        replacement_source = (
            "class __AtlasMemberUpdate__ {\n"
            + replacement_text
            + "\n}\n"
        )

        try:
            replacement_result = (
                self._bridge.parse_source(
                    replacement_source,
                    suffix=self.path.suffix,
                )
            )

            if replacement_result.diagnostics:
                diagnostic = (
                    replacement_result
                    .diagnostics[0]
                )

                if isinstance(
                    diagnostic,
                    dict,
                ):
                    message = (
                        diagnostic.get("message")
                        or diagnostic.get(
                            "messageText"
                        )
                        or str(diagnostic)
                    )
                else:
                    message = str(
                        diagnostic
                    )

                raise UnsupportedTypeScriptImport(
                    "Could not parse replacement "
                    f"member: {message}"
                )

            replacement_navigator = (
                ASTNavigator(
                    replacement_result
                )
            )

            replacement_class = (
                replacement_navigator.class_(
                    "__AtlasMemberUpdate__",
                    required=True,
                )
            )

            replacement_members = (
                replacement_class.members()
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"member: {error}"
            ) from error

        if len(replacement_members) != 1:
            raise UnsupportedTypeScriptImport(
                "replacement_text must contain "
                "exactly one class member"
            )

        replacement = (
            replacement_members[0]
        )

        line_start = (
            current_source.rfind(
                "\n",
                0,
                member.member_start,
            )
            + 1
        )

        member_indent = current_source[
            line_start:
            member.member_start
        ]

        if member_indent.strip():
            member_indent = ""

        indented_replacement_text = (
            replacement_text.replace(
                "\n",
                "\n" + member_indent,
            )
        )

        try:
            plan = (
                MemberUpdatePlanner().plan(
                    MemberUpdateContext(
                        class_name=class_name,
                        member=member,
                        replacement=replacement,
                        replacement_text=(
                            indented_replacement_text
                        ),
                    )
                )
            )
        except (
            InvalidMemberUpdate,
            MemberUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_member",
                "class_name": (
                    plan.class_name
                ),
                "member_name": (
                    plan.member_name
                ),
                "kind": (
                    plan.member_kind
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "replacement_kind": (
                    plan.replacement_kind
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    @staticmethod
    def _normalize_member_tokens(
        value: str | list[str] | tuple[str, ...] | None,
        *,
        field_name: str,
    ) -> tuple[str, ...]:
        if value is None:
            return ()

        if isinstance(value, str):
            items = (value,)
        elif isinstance(value, (list, tuple)):
            items = tuple(value)
        else:
            raise TypeError(
                f"{field_name} must be a string, "
                "list, tuple, or None"
            )

        normalized: list[str] = []

        for item in items:
            if not isinstance(item, str):
                raise TypeError(
                    f"Each {field_name} item "
                    "must be a string"
                )

            item = item.strip()

            if not item:
                raise ValueError(
                    f"{field_name} cannot contain "
                    "empty values"
                )

            normalized.append(item)

        return tuple(normalized)

    @classmethod
    def _render_member_prefix(
        cls,
        *,
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> tuple[str, str]:
        decorator_items = (
            cls._normalize_member_tokens(
                decorators,
                field_name="decorators",
            )
        )

        modifier_items = (
            cls._normalize_member_tokens(
                modifiers,
                field_name="modifiers",
            )
        )

        decorator_lines = []

        for decorator in decorator_items:
            if not decorator.startswith("@"):
                decorator = "@" + decorator

            decorator_lines.append(decorator)

        decorator_text = (
            "\n".join(decorator_lines)
        )

        modifier_text = (
            " ".join(modifier_items)
        )

        return (
            decorator_text,
            modifier_text,
        )

    @staticmethod
    def _render_member_body(
        body: str | None,
    ) -> str:
        if body is None:
            return ""

        if not isinstance(body, str):
            raise TypeError(
                "body must be a string or None"
            )

        body = body.strip("\r\n")

        if not body.strip():
            return ""

        return "\n".join(
            (
                "  " + line
                if line.strip()
                else ""
            )
            for line in body.splitlines()
        )

    def update_method(
        self,
        class_name: str,
        method_name: str,
        *,
        parameters: str = "",
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            parameters,
            str,
        ):
            raise TypeError(
                "parameters must be a string"
            )

        if (
            return_type is not None
            and not isinstance(
                return_type,
                str,
            )
        ):
            raise TypeError(
                "return_type must be a string "
                "or None"
            )

        if not isinstance(
            method_name,
            str,
        ):
            raise TypeError(
                "method_name must be a string"
            )

        method_name = method_name.strip()
        parameters = parameters.strip()

        if not method_name:
            raise ValueError(
                "method_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        return_suffix = ""

        if return_type is not None:
            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        signature_parts = [
            item
            for item in (
                modifier_text,
                (
                    f"{method_name}"
                    f"({parameters})"
                    f"{return_suffix}"
                ),
            )
            if item
        ]

        signature = " ".join(
            signature_parts
        )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            replacement_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            replacement_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            replacement_text = (
                decorator_text
                + "\n"
                + replacement_text
            )

        return self.update_member(
            class_name,
            method_name,
            replacement_text,
            kind="method",
        )

    def update_property(
        self,
        class_name: str,
        property_name: str,
        *,
        type_annotation: str | None = None,
        initializer: str | None = None,
        optional: bool = False,
        definite: bool = False,
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            property_name,
            str,
        ):
            raise TypeError(
                "property_name must be a string"
            )

        if not isinstance(
            optional,
            bool,
        ):
            raise TypeError(
                "optional must be a boolean"
            )

        if not isinstance(
            definite,
            bool,
        ):
            raise TypeError(
                "definite must be a boolean"
            )

        if optional and definite:
            raise ValueError(
                "optional and definite cannot "
                "both be true"
            )

        property_name = property_name.strip()

        if not property_name:
            raise ValueError(
                "property_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        marker = ""

        if optional:
            marker = "?"
        elif definite:
            marker = "!"

        declaration = (
            property_name + marker
        )

        if type_annotation is not None:
            if not isinstance(
                type_annotation,
                str,
            ):
                raise TypeError(
                    "type_annotation must be a "
                    "string or None"
                )

            type_annotation = (
                type_annotation.strip()
            )

            if not type_annotation:
                raise ValueError(
                    "type_annotation cannot be "
                    "empty"
                )

            declaration += (
                f": {type_annotation}"
            )

        if initializer is not None:
            if not isinstance(
                initializer,
                str,
            ):
                raise TypeError(
                    "initializer must be a "
                    "string or None"
                )

            initializer = (
                initializer.strip()
            )

            if not initializer:
                raise ValueError(
                    "initializer cannot be empty"
                )

            declaration += (
                f" = {initializer}"
            )

        declaration += ";"

        if modifier_text:
            declaration = (
                modifier_text
                + " "
                + declaration
            )

        if decorator_text:
            declaration = (
                decorator_text
                + "\n"
                + declaration
            )

        return self.update_member(
            class_name,
            property_name,
            declaration,
            kind="property",
        )

    def update_getter(
        self,
        class_name: str,
        getter_name: str,
        *,
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            getter_name,
            str,
        ):
            raise TypeError(
                "getter_name must be a string"
            )

        getter_name = getter_name.strip()

        if not getter_name:
            raise ValueError(
                "getter_name cannot be empty"
            )

        if (
            return_type is not None
            and not isinstance(
                return_type,
                str,
            )
        ):
            raise TypeError(
                "return_type must be a string "
                "or None"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        return_suffix = ""

        if return_type is not None:
            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        signature_parts = [
            item
            for item in (
                modifier_text,
                (
                    f"get {getter_name}()"
                    f"{return_suffix}"
                ),
            )
            if item
        ]

        signature = " ".join(
            signature_parts
        )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            replacement_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            replacement_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            replacement_text = (
                decorator_text
                + "\n"
                + replacement_text
            )

        return self.update_member(
            class_name,
            getter_name,
            replacement_text,
            kind="getter",
        )

    def update_setter(
        self,
        class_name: str,
        setter_name: str,
        *,
        parameter: str,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            setter_name,
            str,
        ):
            raise TypeError(
                "setter_name must be a string"
            )

        if not isinstance(
            parameter,
            str,
        ):
            raise TypeError(
                "parameter must be a string"
            )

        setter_name = setter_name.strip()
        parameter = parameter.strip()

        if not setter_name:
            raise ValueError(
                "setter_name cannot be empty"
            )

        if not parameter:
            raise ValueError(
                "parameter cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        signature_parts = [
            item
            for item in (
                modifier_text,
                (
                    f"set {setter_name}"
                    f"({parameter})"
                ),
            )
            if item
        ]

        signature = " ".join(
            signature_parts
        )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            replacement_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            replacement_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            replacement_text = (
                decorator_text
                + "\n"
                + replacement_text
            )

        return self.update_member(
            class_name,
            setter_name,
            replacement_text,
            kind="setter",
        )

    def update_constructor(
        self,
        class_name: str,
        *,
        parameters: str = "",
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            parameters,
            str,
        ):
            raise TypeError(
                "parameters must be a string"
            )

        parameters = parameters.strip()

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        signature_parts = [
            item
            for item in (
                modifier_text,
                f"constructor({parameters})",
            )
            if item
        ]

        signature = " ".join(
            signature_parts
        )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            replacement_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            replacement_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            replacement_text = (
                decorator_text
                + "\n"
                + replacement_text
            )

        return self.update_member(
            class_name,
            "constructor",
            replacement_text,
            kind="constructor",
        )

    def add_method(
        self,
        class_name: str,
        method_name: str,
        *,
        parameters: str = "",
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(parameters, str):
            raise TypeError(
                "parameters must be a string"
            )

        if (
            return_type is not None
            and not isinstance(
                return_type,
                str,
            )
        ):
            raise TypeError(
                "return_type must be a string "
                "or None"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        method_name = method_name.strip()
        parameters = parameters.strip()

        return_suffix = ""

        if return_type is not None:
            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        signature_parts = [
            item
            for item in (
                modifier_text,
                f"{method_name}"
                f"({parameters})"
                f"{return_suffix}",
            )
            if item
        ]

        signature = " ".join(
            signature_parts
        )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            member_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                f"}}"
            )
        else:
            member_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            member_text = (
                decorator_text
                + "\n"
                + member_text
            )

        return self.add_member(
            class_name,
            method_name,
            member_text,
            kind="method",
            before=before,
            after=after,
            position=position,
        )

    def add_property(
        self,
        class_name: str,
        property_name: str,
        *,
        type_annotation: str | None = None,
        initializer: str | None = None,
        optional: bool = False,
        definite: bool = False,
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(optional, bool):
            raise TypeError(
                "optional must be a boolean"
            )

        if not isinstance(definite, bool):
            raise TypeError(
                "definite must be a boolean"
            )

        if optional and definite:
            raise ValueError(
                "optional and definite cannot "
                "both be true"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        property_name = property_name.strip()

        marker = ""

        if optional:
            marker = "?"
        elif definite:
            marker = "!"

        declaration = (
            property_name + marker
        )

        if type_annotation is not None:
            if not isinstance(
                type_annotation,
                str,
            ):
                raise TypeError(
                    "type_annotation must be a "
                    "string or None"
                )

            type_annotation = (
                type_annotation.strip()
            )

            if not type_annotation:
                raise ValueError(
                    "type_annotation cannot be "
                    "empty"
                )

            declaration += (
                f": {type_annotation}"
            )

        if initializer is not None:
            if not isinstance(
                initializer,
                str,
            ):
                raise TypeError(
                    "initializer must be a "
                    "string or None"
                )

            initializer = initializer.strip()

            if not initializer:
                raise ValueError(
                    "initializer cannot be empty"
                )

            declaration += (
                f" = {initializer}"
            )

        declaration += ";"

        if modifier_text:
            declaration = (
                modifier_text
                + " "
                + declaration
            )

        if decorator_text:
            declaration = (
                decorator_text
                + "\n"
                + declaration
            )

        return self.add_member(
            class_name,
            property_name,
            declaration,
            kind="property",
            before=before,
            after=after,
            position=position,
        )

    def add_getter(
        self,
        class_name: str,
        property_name: str,
        *,
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        property_name = property_name.strip()

        return_suffix = ""

        if return_type is not None:
            if not isinstance(
                return_type,
                str,
            ):
                raise TypeError(
                    "return_type must be a "
                    "string or None"
                )

            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        prefix = (
            modifier_text + " "
            if modifier_text
            else ""
        )

        signature = (
            f"{prefix}get "
            f"{property_name}()"
            f"{return_suffix}"
        )

        rendered_body = (
            self._render_member_body(body)
        )

        member_text = (
            f"{signature} {{"
            + (
                f"\n{rendered_body}\n"
                if rendered_body
                else ""
            )
            + "}"
        )

        if decorator_text:
            member_text = (
                decorator_text
                + "\n"
                + member_text
            )

        return self.add_member(
            class_name,
            property_name,
            member_text,
            kind="getter",
            before=before,
            after=after,
            position=position,
        )

    def add_setter(
        self,
        class_name: str,
        property_name: str,
        *,
        parameter: str,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(parameter, str):
            raise TypeError(
                "parameter must be a string"
            )

        parameter = parameter.strip()

        if not parameter:
            raise ValueError(
                "parameter cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        property_name = property_name.strip()

        prefix = (
            modifier_text + " "
            if modifier_text
            else ""
        )

        signature = (
            f"{prefix}set "
            f"{property_name}"
            f"({parameter})"
        )

        rendered_body = (
            self._render_member_body(body)
        )

        member_text = (
            f"{signature} {{"
            + (
                f"\n{rendered_body}\n"
                if rendered_body
                else ""
            )
            + "}"
        )

        if decorator_text:
            member_text = (
                decorator_text
                + "\n"
                + member_text
            )

        return self.add_member(
            class_name,
            property_name,
            member_text,
            kind="setter",
            before=before,
            after=after,
            position=position,
        )

    def add_constructor(
        self,
        class_name: str,
        *,
        parameters: str = "",
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(parameters, str):
            raise TypeError(
                "parameters must be a string"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        parameters = parameters.strip()

        prefix = (
            modifier_text + " "
            if modifier_text
            else ""
        )

        signature = (
            f"{prefix}constructor"
            f"({parameters})"
        )

        rendered_body = (
            self._render_member_body(body)
        )

        member_text = (
            f"{signature} {{"
            + (
                f"\n{rendered_body}\n"
                if rendered_body
                else ""
            )
            + "}"
        )

        if decorator_text:
            member_text = (
                decorator_text
                + "\n"
                + member_text
            )

        return self.add_member(
            class_name,
            "constructor",
            member_text,
            kind="constructor",
            before=before,
            after=after,
            position=position,
        )

    def add_member(
        self,
        class_name: str,
        member_name: str,
        member_text: str,
        *,
        kind: str,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        for field_name, value in (
            ("class_name", class_name),
            ("member_name", member_name),
            ("member_text", member_text),
            ("kind", kind),
        ):
            if not isinstance(value, str):
                raise TypeError(
                    f"{field_name} must be a string"
                )

        class_name = class_name.strip()
        member_name = member_name.strip()
        member_text = member_text.strip(
            "\r\n"
        )
        kind = kind.strip()

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not member_name:
            raise ValueError(
                "member_name cannot be empty"
            )

        if not member_text.strip():
            raise ValueError(
                "member_text cannot be empty"
            )

        if not kind:
            raise ValueError(
                "kind cannot be empty"
            )

        for field_name, value in (
            ("before", before),
            ("after", after),
            ("position", position),
        ):
            if (
                value is not None
                and not isinstance(value, str)
            ):
                raise TypeError(
                    f"{field_name} must be a "
                    "string or None"
                )

        before = (
            before.strip()
            if before is not None
            else None
        )

        after = (
            after.strip()
            if after is not None
            else None
        )

        position = (
            position.strip()
            if position is not None
            else None
        )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        class_node = navigator.class_(
            class_name,
            required=False,
        )

        if class_node is None:
            return False

        validation_source = (
            "class __AtlasMemberAdd__ {\n"
            + member_text
            + "\n}\n"
        )

        try:
            validation_result = (
                self._bridge.parse_source(
                    validation_source,
                    suffix=self.path.suffix,
                )
            )

            if validation_result.diagnostics:
                diagnostic = (
                    validation_result
                    .diagnostics[0]
                )

                if isinstance(
                    diagnostic,
                    dict,
                ):
                    message = (
                        diagnostic.get("message")
                        or diagnostic.get(
                            "messageText"
                        )
                        or str(diagnostic)
                    )
                else:
                    message = str(
                        diagnostic
                    )

                raise UnsupportedTypeScriptImport(
                    "Could not parse member_text: "
                    f"{message}"
                )

            validation_class = (
                ASTNavigator(
                    validation_result
                ).class_(
                    "__AtlasMemberAdd__",
                    required=True,
                )
            )

            validation_members = (
                validation_class.members()
            )

        except UnsupportedTypeScriptImport:
            raise
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse member_text: "
                f"{error}"
            ) from error

        if len(validation_members) != 1:
            raise UnsupportedTypeScriptImport(
                "member_text must contain "
                "exactly one class member"
            )

        validation_member = (
            validation_members[0]
        )

        if validation_member.kind != kind:
            raise UnsupportedTypeScriptImport(
                "member_text kind does not match "
                "the requested member kind: "
                f"{validation_member.kind!r} != "
                f"{kind!r}"
            )

        if (
            validation_member.name
            != member_name
        ):
            raise UnsupportedTypeScriptImport(
                "member_text name does not match "
                "the requested member name: "
                f"{validation_member.name!r} != "
                f"{member_name!r}"
            )

        try:
            plan = MemberAddPlanner().plan(
                MemberAddContext(
                    source=current_source,
                    class_node=class_node,
                    member_name=member_name,
                    member_kind=kind,
                    member_text=member_text,
                    before=before,
                    after=after,
                    position=position,
                )
            )
        except UnsupportedTypeScriptImport:
            raise
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "add_member",
                "class_name": class_name,
                "member_name": (
                    plan.member_name
                ),
                "kind": plan.member_kind,
                "direction": (
                    plan.direction.value
                ),
                "target_name": (
                    plan.target_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def remove_member(
        self,
        class_name: str,
        member_name: str,
        *,
        kind: str | None = None,
        force: bool = False,
    ) -> bool:
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

        if not isinstance(
            force,
            bool,
        ):
            raise TypeError(
                "force must be a boolean"
            )

        class_name = class_name.strip()
        member_name = member_name.strip()

        kind = (
            kind.strip()
            if isinstance(kind, str)
            else None
        )

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not member_name:
            raise ValueError(
                "member_name cannot be empty"
            )

        if kind == "":
            raise ValueError(
                "kind cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(
            result
        )

        class_node = navigator.class_(
            class_name,
            required=False,
        )

        if class_node is None:
            return False

        try:
            member = navigator.class_member(
                class_name,
                member_name,
                kind=kind,
                required=False,
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if member is None:
            return False

        if member.kind == "constructor":
            symbol = None
        else:
            try:
                symbol = (
                    navigator.member_rename_symbol(
                        class_name,
                        member_name,
                        kind=kind,
                        required=False,
                    )
                )
            except Exception as error:
                raise UnsupportedTypeScriptImport(
                    str(error)
                ) from error

        declaration_ranges = tuple(
            (
                candidate.identifier_start,
                candidate.identifier_end,
            )
            for candidate
            in class_node.members()
            if (
                candidate.name
                == member_name
                and candidate.identifier_start
                is not None
                and candidate.identifier_end
                is not None
            )
        )

        try:
            plan = (
                MemberRemovalPlanner().plan(
                    MemberRemovalContext(
                        source=current_source,
                        class_name=class_name,
                        class_node=class_node,
                        member=member,
                        symbol=symbol,
                        declaration_ranges=(
                            declaration_ranges
                        ),
                        force=force,
                    )
                )
            )
        except MemberRemovalError as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "remove_member",
                "class_name": (
                    plan.class_name
                ),
                "member_name": (
                    plan.member_name
                ),
                "kind": plan.kind,
                "references": (
                    plan.reference_count
                ),
                "forced": plan.forced,
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def move_member(
        self,
        class_name: str,
        member_name: str,
        *,
        kind: str | None = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
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

        class_name = class_name.strip()
        member_name = member_name.strip()

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not member_name:
            raise ValueError(
                "member_name cannot be empty"
            )

        if kind is not None:
            if not isinstance(kind, str):
                raise TypeError(
                    "kind must be a string or None"
                )

            kind = kind.strip()

        if before is not None:
            if not isinstance(before, str):
                raise TypeError(
                    "before must be a string "
                    "or None"
                )

            before = before.strip()

        if after is not None:
            if not isinstance(after, str):
                raise TypeError(
                    "after must be a string "
                    "or None"
                )

            after = after.strip()

        if position is not None:
            if not isinstance(
                position,
                str,
            ):
                raise TypeError(
                    "position must be a string "
                    "or None"
                )

            position = position.strip()

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(
            result
        )

        class_node = navigator.class_(
            class_name,
            required=False,
        )

        if class_node is None:
            return False

        try:
            member = class_node.member(
                member_name,
                kind=kind,
                required=False,
            )
        except Exception as error:
            from .ast_navigator import (
                ASTNodeAmbiguous,
            )

            if isinstance(
                error,
                ASTNodeAmbiguous,
            ):
                raise UnsupportedTypeScriptImport(
                    str(error)
                ) from error

            raise

        if member is None:
            return False

        try:
            plan = MemberMovePlanner().plan(
                MemberMoveContext(
                    source=current_source,
                    member=member,
                    members=class_node.members(),
                    before=before,
                    after=after,
                    position=position,
                )
            )
        except (
            InvalidMemberMove,
            UnsupportedMemberMove,
            MemberMoveError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if plan is None:
            return False

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "move_member",
                "class_name": class_name,
                "member_name": member_name,
                "kind": plan.source_kind,
                "direction": (
                    plan.direction.value
                ),
                "target_name": (
                    plan.target_name
                ),
                "comment_attached": (
                    plan.comment_attached
                ),
                "engine": (
                    "typescript_ast"
                ),
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def rename_member(
        self,
        class_name: str,
        old_name: str,
        new_name: str,
        *,
        kind: str | None = None,
    ) -> bool:
        if not isinstance(
            class_name,
            str,
        ):
            raise TypeError(
                "class_name must be a string"
            )

        if not isinstance(
            old_name,
            str,
        ):
            raise TypeError(
                "old_name must be a string"
            )

        if not isinstance(
            new_name,
            str,
        ):
            raise TypeError(
                "new_name must be a string"
            )

        if (
            kind is not None
            and not isinstance(kind, str)
        ):
            raise TypeError(
                "kind must be a string or None"
            )

        class_name = class_name.strip()
        old_name = old_name.strip()
        new_name = new_name.strip()
        kind = (
            kind.strip()
            if isinstance(kind, str)
            else None
        )

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not old_name:
            raise ValueError(
                "old_name cannot be empty"
            )

        if not new_name:
            raise ValueError(
                "new_name cannot be empty"
            )

        if old_name == "constructor":
            raise UnsupportedTypeScriptImport(
                "Constructors cannot be renamed"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(
            result
        )

        class_node = navigator.class_(
            class_name,
            required=False,
        )

        if class_node is None:
            return False

        try:
            symbol = (
                navigator.member_rename_symbol(
                    class_name,
                    old_name,
                    kind=kind,
                    required=False,
                )
            )
        except Exception as error:
            from .ast_navigator import (
                ASTNodeAmbiguous,
            )

            if isinstance(
                error,
                ASTNodeAmbiguous,
            ):
                raise UnsupportedTypeScriptImport(
                    str(error)
                ) from error

            raise

        if symbol is None:
            return False

        existing_names = tuple(
            member.name
            for member
            in class_node.members()
        )

        try:
            plan = MemberRenamePlanner().plan(
                MemberRenameContext(
                    symbol=symbol,
                    new_name=new_name,
                    existing_member_names=(
                        existing_names
                    ),
                )
            )
        except (
            MemberRenameConflict,
            InvalidMemberName,
            MemberRenameError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if plan is None:
            return False

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "rename_member",
                "class_name": class_name,
                "old_name": old_name,
                "new_name": new_name,
                "kind": plan.kind,
                "occurrences": len(
                    plan.edits
                ),
                "engine": (
                    "typescript_language_service"
                ),
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_class(
        self,
        class_name: str,
        *,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        extends: str | None = None,
        implements: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            class_name,
            str,
        ):
            raise TypeError(
                "class_name must be a string"
            )

        if not isinstance(
            body,
            str,
        ):
            raise TypeError(
                "body must be a string"
            )

        class_name = class_name.strip()

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        extends_text = ""

        if extends is not None:
            if not isinstance(
                extends,
                str,
            ):
                raise TypeError(
                    "extends must be a string "
                    "or None"
                )

            extends = extends.strip()

            if not extends:
                raise ValueError(
                    "extends cannot be empty"
                )

            extends_text = (
                f" extends {extends}"
            )

        implements_items = (
            self._normalize_member_tokens(
                implements,
                field_name="implements",
            )
        )

        implements_text = ""

        if implements_items:
            implements_text = (
                " implements "
                + ", ".join(
                    implements_items
                )
            )

        header_parts = [
            item
            for item in (
                modifier_text,
                (
                    f"class {class_name}"
                    f"{extends_text}"
                    f"{implements_text}"
                ),
            )
            if item
        ]

        header = " ".join(
            header_parts
        )

        normalized_body = body.strip(
            "\r\n"
        )

        if normalized_body.strip():
            rendered_body = "\n".join(
                (
                    "  " + line
                    if line.strip()
                    else ""
                )
                for line
                in normalized_body.splitlines()
            )

            class_text = (
                f"{header} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            class_text = (
                f"{header} {{}}"
            )

        if decorator_text:
            class_text = (
                decorator_text
                + "\n"
                + class_text
            )

        return self.update_class_text(
            class_name,
            class_text,
        )

    def update_class_text(
        self,
        class_name: str,
        class_text: str,
    ) -> bool:
        if not isinstance(
            class_name,
            str,
        ):
            raise TypeError(
                "class_name must be a string"
            )

        if not isinstance(
            class_text,
            str,
        ):
            raise TypeError(
                "class_text must be a string"
            )

        class_name = class_name.strip()

        class_text = class_text.strip(
            "\r\n"
        )

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        if not class_text.strip():
            raise ValueError(
                "class_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                class_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "class":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    class_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"class: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"class: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "class_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = ClassUpdatePlanner().plan(
                ClassUpdateContext(
                    declaration=declaration,
                    replacement=replacement,
                    replacement_text=(
                        class_text
                    ),
                )
            )
        except (
            InvalidClassUpdate,
            ClassUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_class",
                "class_name": (
                    plan.class_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_function(
        self,
        function_name: str,
        *,
        parameters: str = "",
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
        generator: bool = False,
    ) -> bool:
        if not isinstance(
            function_name,
            str,
        ):
            raise TypeError(
                "function_name must be a string"
            )

        if not isinstance(
            parameters,
            str,
        ):
            raise TypeError(
                "parameters must be a string"
            )

        if not isinstance(
            body,
            str,
        ):
            raise TypeError(
                "body must be a string"
            )

        if not isinstance(
            generator,
            bool,
        ):
            raise TypeError(
                "generator must be a boolean"
            )

        function_name = (
            function_name.strip()
        )

        parameters = parameters.strip()

        if not function_name:
            raise ValueError(
                "function_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            type_parameter_text = (
                type_parameters
                if type_parameters.startswith("<")
                else f"<{type_parameters}>"
            )

        return_suffix = ""

        if return_type is not None:
            if not isinstance(
                return_type,
                str,
            ):
                raise TypeError(
                    "return_type must be a string "
                    "or None"
                )

            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        generator_marker = (
            "*"
            if generator
            else ""
        )

        signature = (
            f"function{generator_marker} "
            f"{function_name}"
            f"{type_parameter_text}"
            f"({parameters})"
            f"{return_suffix}"
        )

        if modifier_text:
            signature = (
                modifier_text
                + " "
                + signature
            )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            function_text = (
                f"{signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            function_text = (
                f"{signature} {{}}"
            )

        if decorator_text:
            function_text = (
                decorator_text
                + "\n"
                + function_text
            )

        return self.update_function_text(
            function_name,
            function_text,
        )

    def update_function_text(
        self,
        function_name: str,
        function_text: str,
    ) -> bool:
        if not isinstance(
            function_name,
            str,
        ):
            raise TypeError(
                "function_name must be a string"
            )

        if not isinstance(
            function_text,
            str,
        ):
            raise TypeError(
                "function_text must be a string"
            )

        function_name = (
            function_name.strip()
        )

        function_text = (
            function_text.strip("\r\n")
        )

        if not function_name:
            raise ValueError(
                "function_name cannot be empty"
            )

        if not function_text.strip():
            raise ValueError(
                "function_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                function_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "function":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    function_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"function: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"function: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "function_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = (
                FunctionUpdatePlanner().plan(
                    FunctionUpdateContext(
                        declaration=declaration,
                        replacement=replacement,
                        replacement_text=(
                            function_text
                        ),
                    )
                )
            )
        except (
            InvalidFunctionUpdate,
            FunctionUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_function",
                "function_name": (
                    plan.function_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_interface(
        self,
        interface_name: str,
        *,
        body: str = "",
        extends: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
    ) -> bool:
        if not isinstance(
            interface_name,
            str,
        ):
            raise TypeError(
                "interface_name must be a string"
            )

        if not isinstance(
            body,
            str,
        ):
            raise TypeError(
                "body must be a string"
            )

        interface_name = (
            interface_name.strip()
        )

        if not interface_name:
            raise ValueError(
                "interface_name cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            type_parameter_text = (
                type_parameters
                if type_parameters.startswith("<")
                else f"<{type_parameters}>"
            )

        extends_items = (
            self._normalize_member_tokens(
                extends,
                field_name="extends",
            )
        )

        extends_text = ""

        if extends_items:
            extends_text = (
                " extends "
                + ", ".join(extends_items)
            )

        header = (
            f"interface {interface_name}"
            f"{type_parameter_text}"
            f"{extends_text}"
        )

        if modifier_text:
            header = (
                modifier_text
                + " "
                + header
            )

        normalized_body = (
            body.strip("\r\n")
        )

        if normalized_body.strip():
            rendered_body = "\n".join(
                (
                    "  " + line
                    if line.strip()
                    else ""
                )
                for line
                in normalized_body.splitlines()
            )

            interface_text = (
                f"{header} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            interface_text = (
                f"{header} {{}}"
            )

        return self.update_interface_text(
            interface_name,
            interface_text,
        )

    def update_interface_text(
        self,
        interface_name: str,
        interface_text: str,
    ) -> bool:
        if not isinstance(
            interface_name,
            str,
        ):
            raise TypeError(
                "interface_name must be a string"
            )

        if not isinstance(
            interface_text,
            str,
        ):
            raise TypeError(
                "interface_text must be a string"
            )

        interface_name = (
            interface_name.strip()
        )

        interface_text = (
            interface_text.strip("\r\n")
        )

        if not interface_name:
            raise ValueError(
                "interface_name cannot be empty"
            )

        if not interface_text.strip():
            raise ValueError(
                "interface_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                interface_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "interface":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    interface_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"interface: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"interface: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "interface_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = (
                InterfaceUpdatePlanner().plan(
                    InterfaceUpdateContext(
                        declaration=declaration,
                        replacement=replacement,
                        replacement_text=(
                            interface_text
                        ),
                    )
                )
            )
        except (
            InvalidInterfaceUpdate,
            InterfaceUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_interface",
                "interface_name": (
                    plan.interface_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_type_alias(
        self,
        type_name: str,
        definition: str,
        *,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
    ) -> bool:
        if not isinstance(
            type_name,
            str,
        ):
            raise TypeError(
                "type_name must be a string"
            )

        if not isinstance(
            definition,
            str,
        ):
            raise TypeError(
                "definition must be a string"
            )

        type_name = type_name.strip()
        definition = definition.strip()

        if not type_name:
            raise ValueError(
                "type_name cannot be empty"
            )

        if not definition:
            raise ValueError(
                "definition cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            type_parameter_text = (
                type_parameters
                if type_parameters.startswith("<")
                else f"<{type_parameters}>"
            )

        declaration = (
            f"type {type_name}"
            f"{type_parameter_text} = "
            f"{definition};"
        )

        if modifier_text:
            declaration = (
                modifier_text
                + " "
                + declaration
            )

        return self.update_type_alias_text(
            type_name,
            declaration,
        )

    def update_type_alias_text(
        self,
        type_name: str,
        type_alias_text: str,
    ) -> bool:
        if not isinstance(
            type_name,
            str,
        ):
            raise TypeError(
                "type_name must be a string"
            )

        if not isinstance(
            type_alias_text,
            str,
        ):
            raise TypeError(
                "type_alias_text must be a string"
            )

        type_name = type_name.strip()

        type_alias_text = (
            type_alias_text.strip("\r\n")
        )

        if not type_name:
            raise ValueError(
                "type_name cannot be empty"
            )

        if not type_alias_text.strip():
            raise ValueError(
                "type_alias_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                type_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "type":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    type_alias_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"type alias: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"type alias: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "type_alias_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = (
                TypeAliasUpdatePlanner().plan(
                    TypeAliasUpdateContext(
                        declaration=declaration,
                        replacement=replacement,
                        replacement_text=(
                            type_alias_text
                        ),
                    )
                )
            )
        except (
            InvalidTypeAliasUpdate,
            TypeAliasUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_type_alias",
                "type_name": (
                    plan.type_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_enum(
        self,
        enum_name: str,
        members: (
            str
            | list[str]
            | tuple[str, ...]
        ),
        *,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
    ) -> bool:
        if not isinstance(
            enum_name,
            str,
        ):
            raise TypeError(
                "enum_name must be a string"
            )

        enum_name = enum_name.strip()

        if not enum_name:
            raise ValueError(
                "enum_name cannot be empty"
            )

        if isinstance(members, str):
            member_items = tuple(
                item.strip()
                for item in members.splitlines()
                if item.strip()
            )
        elif isinstance(
            members,
            (list, tuple),
        ):
            normalized = []

            for item in members:
                if not isinstance(item, str):
                    raise TypeError(
                        "Each enum member must "
                        "be a string"
                    )

                item = item.strip()

                if not item:
                    raise ValueError(
                        "Enum members cannot "
                        "contain empty values"
                    )

                normalized.append(item)

            member_items = tuple(
                normalized
            )
        else:
            raise TypeError(
                "members must be a string, "
                "list, or tuple"
            )

        if not member_items:
            raise ValueError(
                "members cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        rendered_members = []

        for member in member_items:
            member = member.rstrip(",")

            rendered_members.append(
                "  " + member + ","
            )

        header = f"enum {enum_name}"

        if modifier_text:
            header = (
                modifier_text
                + " "
                + header
            )

        enum_text = (
            f"{header} {{\n"
            + "\n".join(
                rendered_members
            )
            + "\n}"
        )

        return self.update_enum_text(
            enum_name,
            enum_text,
        )

    def update_enum_text(
        self,
        enum_name: str,
        enum_text: str,
    ) -> bool:
        if not isinstance(
            enum_name,
            str,
        ):
            raise TypeError(
                "enum_name must be a string"
            )

        if not isinstance(
            enum_text,
            str,
        ):
            raise TypeError(
                "enum_text must be a string"
            )

        enum_name = enum_name.strip()

        enum_text = enum_text.strip(
            "\r\n"
        )

        if not enum_name:
            raise ValueError(
                "enum_name cannot be empty"
            )

        if not enum_text.strip():
            raise ValueError(
                "enum_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                enum_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "enum":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    enum_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"enum: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"enum: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "enum_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = EnumUpdatePlanner().plan(
                EnumUpdateContext(
                    declaration=declaration,
                    replacement=replacement,
                    replacement_text=(
                        enum_text
                    ),
                )
            )
        except (
            InvalidEnumUpdate,
            EnumUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_enum",
                "enum_name": (
                    plan.enum_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def update_variable(
        self,
        variable_name: str,
        *,
        declaration_kind: str = "const",
        type_annotation: str | None = None,
        initializer: str | None = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        definite: bool = False,
    ) -> bool:
        if not isinstance(
            variable_name,
            str,
        ):
            raise TypeError(
                "variable_name must be a string"
            )

        if not isinstance(
            declaration_kind,
            str,
        ):
            raise TypeError(
                "declaration_kind must be a string"
            )

        if not isinstance(
            definite,
            bool,
        ):
            raise TypeError(
                "definite must be a boolean"
            )

        variable_name = (
            variable_name.strip()
        )

        declaration_kind = (
            declaration_kind.strip()
        )

        if not variable_name:
            raise ValueError(
                "variable_name cannot be empty"
            )

        if declaration_kind not in {
            "const",
            "let",
            "var",
        }:
            raise ValueError(
                "declaration_kind must be "
                "'const', 'let', or 'var'"
            )

        if (
            definite
            and declaration_kind == "const"
        ):
            raise ValueError(
                "const variables cannot use "
                "a definite assignment assertion"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        name_text = variable_name

        if definite:
            name_text += "!"

        type_text = ""

        if type_annotation is not None:
            if not isinstance(
                type_annotation,
                str,
            ):
                raise TypeError(
                    "type_annotation must be a "
                    "string or None"
                )

            type_annotation = (
                type_annotation.strip()
            )

            if not type_annotation:
                raise ValueError(
                    "type_annotation cannot be empty"
                )

            type_text = (
                f": {type_annotation}"
            )

        initializer_text = ""

        if initializer is not None:
            if not isinstance(
                initializer,
                str,
            ):
                raise TypeError(
                    "initializer must be a "
                    "string or None"
                )

            initializer = (
                initializer.strip()
            )

            if not initializer:
                raise ValueError(
                    "initializer cannot be empty"
                )

            initializer_text = (
                f" = {initializer}"
            )

        if (
            declaration_kind == "const"
            and initializer is None
        ):
            raise ValueError(
                "const variables require "
                "an initializer"
            )

        variable_text = (
            f"{declaration_kind} "
            f"{name_text}"
            f"{type_text}"
            f"{initializer_text};"
        )

        if modifier_text:
            variable_text = (
                modifier_text
                + " "
                + variable_text
            )

        return self.update_variable_text(
            variable_name,
            variable_text,
        )

    def update_variable_text(
        self,
        variable_name: str,
        variable_text: str,
    ) -> bool:
        if not isinstance(
            variable_name,
            str,
        ):
            raise TypeError(
                "variable_name must be a string"
            )

        if not isinstance(
            variable_text,
            str,
        ):
            raise TypeError(
                "variable_text must be a string"
            )

        variable_name = (
            variable_name.strip()
        )

        variable_text = (
            variable_text.strip("\r\n")
        )

        if not variable_name:
            raise ValueError(
                "variable_name cannot be empty"
            )

        if not variable_text.strip():
            raise ValueError(
                "variable_text cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declaration = (
            navigator.declaration(
                variable_name,
                required=False,
            )
        )

        if declaration is None:
            return False

        if declaration.kind != "variable":
            return False

        try:
            replacement_result = (
                self._bridge.parse_source(
                    variable_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"variable: {error}"
            ) from error

        if replacement_result.diagnostics:
            diagnostic = (
                replacement_result
                .diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse replacement "
                f"variable: {message}"
            )

        replacement_navigator = (
            ASTNavigator(
                replacement_result
            )
        )

        replacements = (
            replacement_navigator
            .declarations()
        )

        if len(replacements) != 1:
            raise UnsupportedTypeScriptImport(
                "variable_text must contain "
                "exactly one declaration"
            )

        replacement = replacements[0]

        try:
            plan = (
                VariableUpdatePlanner().plan(
                    VariableUpdateContext(
                        declaration=declaration,
                        replacement=replacement,
                        variable_name=(
                            variable_name
                        ),
                        replacement_text=(
                            variable_text
                        ),
                    )
                )
            )
        except (
            InvalidVariableUpdate,
            VariableUpdateError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "update_variable",
                "variable_name": (
                    plan.variable_name
                ),
                "replacement_name": (
                    plan.replacement_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def add_variable_text(
        self,
        variable_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            variable_text,
            str,
        ):
            raise TypeError(
                "variable_text must be a string"
            )

        variable_text = (
            variable_text.strip("\r\n")
        )

        if not variable_text.strip():
            raise ValueError(
                "variable_text cannot be empty"
            )

        try:
            result = self._bridge.parse_source(
                variable_text + "\n",
                suffix=self.path.suffix,
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse variable text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = (
                result.diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse variable text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)

        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "variable_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "variable":
            raise UnsupportedTypeScriptImport(
                "variable_text must contain "
                "exactly one variable statement"
            )

        declarators = (
            declaration.variable_declarators
        )

        if len(declarators) != 1:
            raise UnsupportedTypeScriptImport(
                "variable_text must contain "
                "exactly one variable declarator"
            )

        declarator = declarators[0]

        if (
            declarator.destructuring
            or len(declarator.names) != 1
        ):
            raise UnsupportedTypeScriptImport(
                "Destructuring variable "
                "declarations are not supported"
            )

        variable_name = (
            declarator.names[0]
        )

        return self.add_declaration(
            variable_name,
            variable_text,
            kind="variable",
            before=before,
            after=after,
            position=position,
        )

    def add_variable(
        self,
        variable_name: str,
        *,
        declaration_kind: str = "const",
        type_annotation: str | None = None,
        initializer: str | None = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        definite: bool = False,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            variable_name,
            str,
        ):
            raise TypeError(
                "variable_name must be a string"
            )

        if not isinstance(
            declaration_kind,
            str,
        ):
            raise TypeError(
                "declaration_kind must be a string"
            )

        if not isinstance(
            definite,
            bool,
        ):
            raise TypeError(
                "definite must be a boolean"
            )

        variable_name = (
            variable_name.strip()
        )

        declaration_kind = (
            declaration_kind.strip()
        )

        if not variable_name:
            raise ValueError(
                "variable_name cannot be empty"
            )

        if declaration_kind not in {
            "const",
            "let",
            "var",
        }:
            raise ValueError(
                "declaration_kind must be "
                "'const', 'let', or 'var'"
            )

        if (
            definite
            and declaration_kind == "const"
        ):
            raise ValueError(
                "const variables cannot use "
                "a definite assignment assertion"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        name_text = variable_name

        if definite:
            name_text += "!"

        type_text = ""

        if type_annotation is not None:
            if not isinstance(
                type_annotation,
                str,
            ):
                raise TypeError(
                    "type_annotation must be a "
                    "string or None"
                )

            type_annotation = (
                type_annotation.strip()
            )

            if not type_annotation:
                raise ValueError(
                    "type_annotation cannot be empty"
                )

            type_text = (
                f": {type_annotation}"
            )

        initializer_text = ""

        if initializer is not None:
            if not isinstance(
                initializer,
                str,
            ):
                raise TypeError(
                    "initializer must be a "
                    "string or None"
                )

            initializer = initializer.strip()

            if not initializer:
                raise ValueError(
                    "initializer cannot be empty"
                )

            initializer_text = (
                f" = {initializer}"
            )

        if (
            declaration_kind == "const"
            and initializer is None
        ):
            raise ValueError(
                "const variables require "
                "an initializer"
            )

        variable_text = (
            f"{declaration_kind} "
            f"{name_text}"
            f"{type_text}"
            f"{initializer_text};"
        )

        if modifier_text:
            variable_text = (
                modifier_text
                + " "
                + variable_text
            )

        return self.add_variable_text(
            variable_text,
            before=before,
            after=after,
            position=position,
        )

    def add_enum_text(
        self,
        enum_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            enum_text,
            str,
        ):
            raise TypeError(
                "enum_text must be a string"
            )

        enum_text = enum_text.strip(
            "\r\n"
        )

        if not enum_text.strip():
            raise ValueError(
                "enum_text cannot be empty"
            )

        try:
            result = (
                self._bridge.parse_source(
                    enum_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse enum text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = (
                result.diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse enum text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)

        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "enum_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "enum":
            raise UnsupportedTypeScriptImport(
                "enum_text must contain "
                "exactly one enum declaration"
            )

        if declaration.name is None:
            raise UnsupportedTypeScriptImport(
                "Anonymous enums are not supported"
            )

        return self.add_declaration(
            declaration.name,
            enum_text,
            kind="enum",
            before=before,
            after=after,
            position=position,
        )

    def add_enum(
        self,
        enum_name: str,
        members: (
            str
            | list[str]
            | tuple[str, ...]
        ),
        *,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            enum_name,
            str,
        ):
            raise TypeError(
                "enum_name must be a string"
            )

        enum_name = enum_name.strip()

        if not enum_name:
            raise ValueError(
                "enum_name cannot be empty"
            )

        if isinstance(members, str):
            member_items = tuple(
                item.strip()
                for item in members.splitlines()
                if item.strip()
            )
        elif isinstance(
            members,
            (list, tuple),
        ):
            normalized = []

            for item in members:
                if not isinstance(item, str):
                    raise TypeError(
                        "Each enum member must "
                        "be a string"
                    )

                item = item.strip()

                if not item:
                    raise ValueError(
                        "Enum members cannot "
                        "contain empty values"
                    )

                normalized.append(item)

            member_items = tuple(
                normalized
            )
        else:
            raise TypeError(
                "members must be a string, "
                "list, or tuple"
            )

        if not member_items:
            raise ValueError(
                "members cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        rendered_members = []

        for member in member_items:
            member = member.rstrip(",")

            rendered_members.append(
                "  " + member + ","
            )

        header = (
            f"enum {enum_name}"
        )

        if modifier_text:
            header = (
                modifier_text
                + " "
                + header
            )

        enum_text = (
            f"{header} {{\n"
            + "\n".join(
                rendered_members
            )
            + "\n}"
        )

        return self.add_enum_text(
            enum_text,
            before=before,
            after=after,
            position=position,
        )

    def add_type_alias_text(
        self,
        type_alias_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            type_alias_text,
            str,
        ):
            raise TypeError(
                "type_alias_text must be a string"
            )

        type_alias_text = (
            type_alias_text.strip("\r\n")
        )

        if not type_alias_text.strip():
            raise ValueError(
                "type_alias_text cannot be empty"
            )

        try:
            result = self._bridge.parse_source(
                type_alias_text + "\n",
                suffix=self.path.suffix,
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse type alias text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = result.diagnostics[0]

            if isinstance(diagnostic, dict):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse type alias text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)

        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "type_alias_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "type":
            raise UnsupportedTypeScriptImport(
                "type_alias_text must contain "
                "exactly one type alias declaration"
            )

        if declaration.name is None:
            raise UnsupportedTypeScriptImport(
                "Anonymous type aliases are "
                "not supported"
            )

        return self.add_declaration(
            declaration.name,
            type_alias_text,
            kind="type",
            before=before,
            after=after,
            position=position,
        )

    def add_type_alias(
        self,
        type_name: str,
        definition: str,
        *,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            type_name,
            str,
        ):
            raise TypeError(
                "type_name must be a string"
            )

        if not isinstance(
            definition,
            str,
        ):
            raise TypeError(
                "definition must be a string"
            )

        type_name = type_name.strip()
        definition = definition.strip()

        if not type_name:
            raise ValueError(
                "type_name cannot be empty"
            )

        if not definition:
            raise ValueError(
                "definition cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            type_parameter_text = (
                type_parameters
                if type_parameters.startswith("<")
                else f"<{type_parameters}>"
            )

        declaration = (
            f"type {type_name}"
            f"{type_parameter_text} = "
            f"{definition};"
        )

        if modifier_text:
            declaration = (
                modifier_text
                + " "
                + declaration
            )

        return self.add_type_alias_text(
            declaration,
            before=before,
            after=after,
            position=position,
        )

    def add_interface_text(
        self,
        interface_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            interface_text,
            str,
        ):
            raise TypeError(
                "interface_text must be a string"
            )

        interface_text = (
            interface_text.strip("\r\n")
        )

        if not interface_text.strip():
            raise ValueError(
                "interface_text cannot be empty"
            )

        try:
            result = self._bridge.parse_source(
                interface_text + "\n",
                suffix=self.path.suffix,
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse interface text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = result.diagnostics[0]

            if isinstance(diagnostic, dict):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse interface text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)
        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "interface_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "interface":
            raise UnsupportedTypeScriptImport(
                "interface_text must contain "
                "exactly one interface declaration"
            )

        if declaration.name is None:
            raise UnsupportedTypeScriptImport(
                "Anonymous interfaces are "
                "not supported"
            )

        return self.add_declaration(
            declaration.name,
            interface_text,
            kind="interface",
            before=before,
            after=after,
            position=position,
        )

    def add_interface(
        self,
        interface_name: str,
        *,
        body: str = "",
        extends: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            interface_name,
            str,
        ):
            raise TypeError(
                "interface_name must be a string"
            )

        if not isinstance(body, str):
            raise TypeError(
                "body must be a string"
            )

        interface_name = (
            interface_name.strip()
        )

        if not interface_name:
            raise ValueError(
                "interface_name cannot be empty"
            )

        _, modifier_text = (
            self._render_member_prefix(
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            type_parameter_text = (
                type_parameters
                if type_parameters.startswith("<")
                else f"<{type_parameters}>"
            )

        extends_items = (
            self._normalize_member_tokens(
                extends,
                field_name="extends",
            )
        )

        extends_text = ""

        if extends_items:
            extends_text = (
                " extends "
                + ", ".join(extends_items)
            )

        header = (
            f"interface {interface_name}"
            f"{type_parameter_text}"
            f"{extends_text}"
        )

        if modifier_text:
            header = (
                modifier_text
                + " "
                + header
            )

        normalized_body = body.strip(
            "\r\n"
        )

        if normalized_body.strip():
            rendered_body = "\n".join(
                (
                    "  " + line
                    if line.strip()
                    else ""
                )
                for line
                in normalized_body.splitlines()
            )

            interface_text = (
                f"{header} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            interface_text = (
                f"{header} {{}}"
            )

        return self.add_interface_text(
            interface_text,
            before=before,
            after=after,
            position=position,
        )

    def add_function_text(
        self,
        function_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            function_text,
            str,
        ):
            raise TypeError(
                "function_text must be a string"
            )

        function_text = (
            function_text.strip("\r\n")
        )

        if not function_text.strip():
            raise ValueError(
                "function_text cannot be empty"
            )

        try:
            result = (
                self._bridge.parse_source(
                    function_text + "\n",
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse function text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = result.diagnostics[0]

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or diagnostic.get(
                        "messageText"
                    )
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse function text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)

        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "function_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "function":
            raise UnsupportedTypeScriptImport(
                "function_text must contain "
                "exactly one function declaration"
            )

        if declaration.name is None:
            raise UnsupportedTypeScriptImport(
                "Anonymous function declarations "
                "are not supported"
            )

        return self.add_declaration(
            declaration.name,
            function_text,
            kind="function",
            before=before,
            after=after,
            position=position,
        )

    def add_function(
        self,
        function_name: str,
        *,
        parameters: str = "",
        return_type: str | None = None,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        type_parameters: str | None = None,
        generator: bool = False,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            function_name,
            str,
        ):
            raise TypeError(
                "function_name must be a string"
            )

        if not isinstance(
            parameters,
            str,
        ):
            raise TypeError(
                "parameters must be a string"
            )

        if not isinstance(
            body,
            str,
        ):
            raise TypeError(
                "body must be a string"
            )

        if not isinstance(
            generator,
            bool,
        ):
            raise TypeError(
                "generator must be a boolean"
            )

        function_name = (
            function_name.strip()
        )

        parameters = parameters.strip()

        if not function_name:
            raise ValueError(
                "function_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        type_parameter_text = ""

        if type_parameters is not None:
            if not isinstance(
                type_parameters,
                str,
            ):
                raise TypeError(
                    "type_parameters must be a "
                    "string or None"
                )

            type_parameters = (
                type_parameters.strip()
            )

            if not type_parameters:
                raise ValueError(
                    "type_parameters cannot be empty"
                )

            if type_parameters.startswith("<"):
                type_parameter_text = (
                    type_parameters
                )
            else:
                type_parameter_text = (
                    f"<{type_parameters}>"
                )

        return_suffix = ""

        if return_type is not None:
            if not isinstance(
                return_type,
                str,
            ):
                raise TypeError(
                    "return_type must be a string "
                    "or None"
                )

            return_type = return_type.strip()

            if not return_type:
                raise ValueError(
                    "return_type cannot be empty"
                )

            return_suffix = (
                f": {return_type}"
            )

        generator_marker = (
            "*"
            if generator
            else ""
        )

        function_signature = (
            f"function{generator_marker} "
            f"{function_name}"
            f"{type_parameter_text}"
            f"({parameters})"
            f"{return_suffix}"
        )

        if modifier_text:
            function_signature = (
                modifier_text
                + " "
                + function_signature
            )

        rendered_body = (
            self._render_member_body(body)
        )

        if rendered_body:
            function_text = (
                f"{function_signature} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            function_text = (
                f"{function_signature} {{}}"
            )

        if decorator_text:
            function_text = (
                decorator_text
                + "\n"
                + function_text
            )

        return self.add_function_text(
            function_text,
            before=before,
            after=after,
            position=position,
        )

    def add_class_text(
        self,
        class_text: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            class_text,
            str,
        ):
            raise TypeError(
                "class_text must be a string"
            )

        class_text = class_text.strip(
            "\r\n"
        )

        if not class_text.strip():
            raise ValueError(
                "class_text cannot be empty"
            )

        wrapper_source = (
            class_text
            + "\n"
        )

        try:
            result = (
                self._bridge.parse_source(
                    wrapper_source,
                    suffix=self.path.suffix,
                )
            )
        except Exception as error:
            raise UnsupportedTypeScriptImport(
                "Could not parse class text: "
                f"{error}"
            ) from error

        if result.diagnostics:
            diagnostic = (
                result.diagnostics[0]
            )

            if isinstance(
                diagnostic,
                dict,
            ):
                message = (
                    diagnostic.get("message")
                    or str(diagnostic)
                )
            else:
                message = str(diagnostic)

            raise UnsupportedTypeScriptImport(
                "Could not parse class text: "
                f"{message}"
            )

        navigator = ASTNavigator(result)

        declarations = (
            navigator.declarations()
        )

        if len(declarations) != 1:
            raise UnsupportedTypeScriptImport(
                "class_text must contain "
                "exactly one declaration"
            )

        declaration = declarations[0]

        if declaration.kind != "class":
            raise UnsupportedTypeScriptImport(
                "class_text must contain "
                "exactly one class declaration"
            )

        if declaration.name is None:
            raise UnsupportedTypeScriptImport(
                "Anonymous class declarations "
                "are not supported"
            )

        return self.add_declaration(
            declaration.name,
            class_text,
            kind="class",
            before=before,
            after=after,
            position=position,
        )

    def add_class(
        self,
        class_name: str,
        *,
        body: str = "",
        decorators: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        modifiers: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        extends: str | None = None,
        implements: (
            str
            | list[str]
            | tuple[str, ...]
            | None
        ) = None,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(
            class_name,
            str,
        ):
            raise TypeError(
                "class_name must be a string"
            )

        if not isinstance(
            body,
            str,
        ):
            raise TypeError(
                "body must be a string"
            )

        class_name = class_name.strip()

        if not class_name:
            raise ValueError(
                "class_name cannot be empty"
            )

        decorator_text, modifier_text = (
            self._render_member_prefix(
                decorators=decorators,
                modifiers=modifiers,
            )
        )

        extends_text = ""

        if extends is not None:
            if not isinstance(
                extends,
                str,
            ):
                raise TypeError(
                    "extends must be a string "
                    "or None"
                )

            extends = extends.strip()

            if not extends:
                raise ValueError(
                    "extends cannot be empty"
                )

            extends_text = (
                f" extends {extends}"
            )

        implements_items = (
            self._normalize_member_tokens(
                implements,
                field_name="implements",
            )
        )

        implements_text = ""

        if implements_items:
            implements_text = (
                " implements "
                + ", ".join(
                    implements_items
                )
            )

        class_header_parts = [
            item
            for item in (
                modifier_text,
                (
                    f"class {class_name}"
                    f"{extends_text}"
                    f"{implements_text}"
                ),
            )
            if item
        ]

        class_header = " ".join(
            class_header_parts
        )

        normalized_body = body.strip(
            "\r\n"
        )

        if normalized_body.strip():
            rendered_body = "\n".join(
                (
                    "  " + line
                    if line.strip()
                    else ""
                )
                for line
                in normalized_body.splitlines()
            )

            class_text = (
                f"{class_header} {{\n"
                f"{rendered_body}\n"
                "}"
            )
        else:
            class_text = (
                f"{class_header} {{}}"
            )

        if decorator_text:
            class_text = (
                decorator_text
                + "\n"
                + class_text
            )

        return self.add_class_text(
            class_text,
            before=before,
            after=after,
            position=position,
        )

    def add_declaration(
        self,
        declaration_name: str,
        declaration_text: str,
        *,
        kind: str,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        for field_name, value in (
            (
                "declaration_name",
                declaration_name,
            ),
            (
                "declaration_text",
                declaration_text,
            ),
            ("kind", kind),
        ):
            if not isinstance(value, str):
                raise TypeError(
                    f"{field_name} must be a string"
                )

        declaration_name = (
            declaration_name.strip()
        )

        declaration_text = (
            declaration_text
            .strip("\r\n")
        )

        kind = kind.strip()

        if not declaration_name:
            raise ValueError(
                "declaration_name cannot be empty"
            )

        if not declaration_text.strip():
            raise ValueError(
                "declaration_text cannot be empty"
            )

        if not kind:
            raise ValueError(
                "kind cannot be empty"
            )

        for field_name, value in (
            ("before", before),
            ("after", after),
            ("position", position),
        ):
            if (
                value is not None
                and not isinstance(value, str)
            ):
                raise TypeError(
                    f"{field_name} must be a "
                    "string or None"
                )

        before = (
            before.strip()
            if before is not None
            else None
        )

        after = (
            after.strip()
            if after is not None
            else None
        )

        position = (
            position.strip()
            if position is not None
            else None
        )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        try:
            plan = (
                DeclarationAddPlanner().plan(
                    DeclarationAddContext(
                        source=current_source,
                        declaration_name=(
                            declaration_name
                        ),
                        declaration_kind=kind,
                        declaration_text=(
                            declaration_text
                        ),
                        declarations=(
                            navigator.declarations()
                        ),
                        imports=(
                            navigator.imports()
                        ),
                        before=before,
                        after=after,
                        position=position,
                    )
                )
            )
        except (
            DeclarationAddConflict,
            InvalidDeclarationAdd,
            DeclarationAddError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "add_declaration",
                "declaration_name": (
                    plan.declaration_name
                ),
                "kind": (
                    plan.declaration_kind
                ),
                "direction": (
                    plan.direction.value
                ),
                "target_name": (
                    plan.target_name
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def rename_declaration(
        self,
        old_name: str,
        new_name: str,
    ) -> bool:
        if not isinstance(old_name, str):
            raise TypeError(
                "old_name must be a string"
            )

        if not isinstance(new_name, str):
            raise TypeError(
                "new_name must be a string"
            )

        old_name = old_name.strip()
        new_name = new_name.strip()

        if not old_name:
            raise ValueError(
                "old_name cannot be empty"
            )

        if not new_name:
            raise ValueError(
                "new_name cannot be empty"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(
            result
        )

        symbol = navigator.rename_symbol(
            old_name,
            required=False,
        )

        if symbol is None:
            return False

        existing_names = tuple(
            name
            for declaration
            in navigator.declarations()
            for name in declaration.names
        )

        try:
            plan = DeclarationRenamePlanner().plan(
                DeclarationRenameContext(
                    symbol=symbol,
                    new_name=new_name,
                    existing_declaration_names=(
                        existing_names
                    ),
                )
            )
        except (
            DeclarationRenameConflict,
            InvalidDeclarationName,
            DeclarationRenameError,
        ) as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if plan is None:
            return False

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": (
                    "rename_declaration"
                ),
                "old_name": old_name,
                "new_name": new_name,
                "kind": plan.kind,
                "occurrences": len(
                    plan.edits
                ),
                "engine": (
                    "typescript_language_service"
                ),
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def move_declaration(
        self,
        name: str,
        *,
        before: str | None = None,
        after: str | None = None,
        position: str | None = None,
    ) -> bool:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        name = name.strip()

        if not name:
            raise ValueError(
                "name cannot be empty"
            )

        if before is not None:
            if not isinstance(before, str):
                raise TypeError(
                    "before must be a string "
                    "or None"
                )

            before = before.strip()

            if not before:
                raise ValueError(
                    "before cannot be empty"
                )

        if after is not None:
            if not isinstance(after, str):
                raise TypeError(
                    "after must be a string "
                    "or None"
                )

            after = after.strip()

            if not after:
                raise ValueError(
                    "after cannot be empty"
                )

        if position is not None:
            if not isinstance(position, str):
                raise TypeError(
                    "position must be a string "
                    "or None"
                )

            position = position.strip()

            if not position:
                raise ValueError(
                    "position cannot be empty"
                )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        declarations = tuple(
            navigator.declarations()
        )

        matches = [
            declaration
            for declaration in declarations
            if declaration.contains_name(name)
        ]

        if not matches:
            return False

        if len(matches) > 1:
            raise UnsupportedTypeScriptImport(
                f"More than one declaration "
                f"containing {name!r} was found"
            )

        declaration = matches[0]

        try:
            plan = DeclarationMovePlanner().plan(
                DeclarationMoveContext(
                    source=current_source,
                    declaration=declaration,
                    declarations=declarations,
                    before=before,
                    after=after,
                    position=position,
                )
            )
        except DeclarationMoveError as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if plan is None:
            return False

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": (
                    "move_declaration"
                ),
                "name": name,
                "kind": plan.source_kind,
                "direction": (
                    plan.direction.value
                ),
                "target": plan.target_name,
                "position": position,
                "comment_attached": (
                    plan.comment_attached
                ),
                "engine": "typescript_ast",
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def remove_declaration(
        self,
        name: str,
        *,
        force: bool = False,
    ) -> bool:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        name = name.strip()

        if not name:
            raise ValueError(
                "name cannot be empty"
            )

        if not isinstance(force, bool):
            raise TypeError(
                "force must be a boolean"
            )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        navigator = ASTNavigator(result)

        matches = [
            declaration
            for declaration
            in navigator.declarations()
            if declaration.contains_name(name)
        ]

        if not matches:
            return False

        if len(matches) > 1:
            raise UnsupportedTypeScriptImport(
                f"More than one declaration "
                f"containing {name!r} was found"
            )

        declaration = matches[0]

        symbol = navigator.rename_symbol(
            name,
            required=False,
        )

        try:
            plan = (
                DeclarationRemovalPlanner().plan(
                    DeclarationRemovalContext(
                        source=current_source,
                        declaration=declaration,
                        symbol=symbol,
                        name=name,
                        force=force,
                    )
                )
            )
        except DeclarationRemovalError as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": (
                    "remove_declaration"
                ),
                "name": name,
                "kind": declaration.kind,
                "shape": plan.shape.value,
                "force": force,
                "dangling_references": (
                    plan.reference_count
                ),
                "engine": (
                    "typescript_language_service"
                ),
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def _modify_declaration_export(
        self,
        name: str,
        *,
        default: bool = False,
        remove: bool = False,
        default_only: bool = False,
    ) -> bool:
        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        declarations = ASTNavigator(
            result
        ).declarations()

        matches = [
            node
            for node in declarations
            if node.contains_name(name)
        ]

        if not matches:
            return False

        if len(matches) > 1:
            raise UnsupportedTypeScriptImport(
                f"More than one declaration "
                f"containing {name!r} was found"
            )

        declaration = matches[0]

        try:
            plan = DeclarationExportPlanner().plan(
                DeclarationExportContext(
                    source=current_source,
                    declaration=declaration,
                    default=default,
                    remove=remove,
                    default_only=default_only,
                )
            )
        except InvalidDeclarationExport as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        if plan is None:
            return False

        editor = BridgeEditor(
            current_source,
            result,
        )

        for edit in plan.edits:
            editor.replace(
                edit.start,
                edit.end,
                edit.text,
            )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": (
                    "unexport_declaration"
                    if remove
                    else "export_declaration"
                ),
                "name": name,
                "kind": declaration.kind,
                "default": default,
                "default_only": default_only,
                "engine": "typescript_ast",
                "shape": plan.shape.value,
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def export_declaration(
        self,
        name: str,
        *,
        default: bool = False,
    ) -> bool:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        name = name.strip()

        if not name:
            raise ValueError(
                "name cannot be empty"
            )

        if not isinstance(default, bool):
            raise TypeError(
                "default must be a boolean"
            )

        return self._modify_declaration_export(
            name,
            default=default,
        )

    def unexport_declaration(
        self,
        name: str,
        *,
        default_only: bool = False,
    ) -> bool:
        if not isinstance(name, str):
            raise TypeError(
                "name must be a string"
            )

        name = name.strip()

        if not name:
            raise ValueError(
                "name cannot be empty"
            )

        if not isinstance(
            default_only,
            bool,
        ):
            raise TypeError(
                "default_only must be a boolean"
            )

        return self._modify_declaration_export(
            name,
            remove=True,
            default_only=default_only,
        )

    def remove_export(
        self,
        symbol: str,
        from_module: str | None = None,
    ) -> bool:
        if not isinstance(symbol, str):
            raise TypeError(
                "symbol must be a string"
            )

        if (
            from_module is not None
            and not isinstance(
                from_module,
                str,
            )
        ):
            raise TypeError(
                "from_module must be a string "
                "or None"
            )

        symbol = symbol.strip()

        if not symbol:
            raise ValueError(
                "symbol cannot be empty"
            )

        if from_module is not None:
            from_module = (
                from_module.strip()
            )

            if not from_module:
                raise ValueError(
                    "from_module cannot be empty"
                )

        current_source = self.source()

        result = self._bridge.parse_source(
            current_source,
            suffix=self.path.suffix,
        )

        exports = ASTNavigator(
            result
        ).exports()

        try:
            plan = ExportRemovalPlanner().plan(
                ExportRemovalContext(
                    source=current_source,
                    symbol=symbol,
                    module=from_module,
                    exports=exports,
                )
            )
        except ExportRemovalNotFound:
            return False
        except ExportRemovalAmbiguous as error:
            raise UnsupportedTypeScriptImport(
                str(error)
            ) from error

        editor = BridgeEditor(
            current_source,
            result,
        )

        editor.replace(
            plan.start,
            plan.end,
            plan.text,
        )

        changed = editor.apply()

        if not changed:
            return False

        self._current_text = editor.source()
        self._ast_import_edits_active = True

        self.operations.append(
            {
                "action": "remove_export",
                "symbol": symbol,
                "module": from_module,
                "engine": "typescript_ast",
                "shape": plan.shape.value,
            }
        )

        self.dirty = (
            self._current_text
            != self._original_text
        )

        return True

    def save(self) -> bool:
        new_text = self.source()

        if new_text == self._original_text:
            self.dirty = False
            return False

        self.path.write_text(
            new_text,
            encoding="utf-8",
        )

        self._original_text = new_text
        self._current_text = new_text
        self.dirty = False

        return True
