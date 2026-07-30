from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .ast_navigator import ASTNavigator
from .bridge import TypeScriptBridge
from .bridge_editor import BridgeEditor
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
