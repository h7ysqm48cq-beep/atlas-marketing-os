from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


class InvalidImportNode(ValueError):
    """Raised when parser import metadata is incomplete or invalid."""


def _required_int(
    payload: Mapping[str, Any],
    key: str,
) -> int:
    value = payload.get(key)

    if not isinstance(value, int):
        raise InvalidImportNode(
            f"Expected integer field {key!r}, received {value!r}"
        )

    return value


def _optional_int(
    payload: Mapping[str, Any],
    key: str,
) -> int | None:
    value = payload.get(key)

    if value is None:
        return None

    if not isinstance(value, int):
        raise InvalidImportNode(
            f"Expected integer or null field {key!r}, "
            f"received {value!r}"
        )

    return value


def _optional_string(
    payload: Mapping[str, Any],
    key: str,
) -> str | None:
    value = payload.get(key)

    if value is None:
        return None

    if not isinstance(value, str):
        raise InvalidImportNode(
            f"Expected string or null field {key!r}, "
            f"received {value!r}"
        )

    return value


@dataclass(frozen=True, slots=True)
class NamedImportNode:
    imported: str
    local: str
    type_only: bool
    start: int
    end: int
    start_line: int
    start_column: int
    end_line: int
    end_column: int

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
    ) -> "NamedImportNode":
        imported = payload.get("imported")
        local = payload.get("local")

        if not isinstance(imported, str) or not imported:
            raise InvalidImportNode(
                "Named import requires a non-empty imported name"
            )

        if not isinstance(local, str) or not local:
            raise InvalidImportNode(
                "Named import requires a non-empty local name"
            )

        return cls(
            imported=imported,
            local=local,
            type_only=bool(payload.get("typeOnly")),
            start=_required_int(payload, "start"),
            end=_required_int(payload, "end"),
            start_line=_required_int(payload, "startLine"),
            start_column=_required_int(payload, "startColumn"),
            end_line=_required_int(payload, "endLine"),
            end_column=_required_int(payload, "endColumn"),
        )

    @property
    def aliased(self) -> bool:
        return self.imported != self.local

    def matches_local(self, symbol: str) -> bool:
        return self.local == symbol

    def matches_imported(self, symbol: str) -> bool:
        return self.imported == symbol


@dataclass(frozen=True, slots=True)
class ImportNode:
    module: str
    quote_style: str
    side_effect_only: bool
    default_import: str | None
    namespace_import: str | None
    named_imports: tuple[NamedImportNode, ...]
    type_only: bool
    import_clause_start: int | None
    import_clause_end: int | None
    named_bindings_start: int | None
    named_bindings_end: int | None
    module_specifier_start: int
    module_specifier_end: int
    start: int
    end: int
    start_line: int
    start_column: int
    end_line: int
    end_column: int

    @classmethod
    def from_payload(
        cls,
        payload: Mapping[str, Any],
    ) -> "ImportNode":
        module = payload.get("module")
        quote_style = payload.get("quoteStyle")
        named_payload = payload.get("namedImports", [])

        if not isinstance(module, str) or not module:
            raise InvalidImportNode(
                "Import node requires a non-empty module"
            )

        if quote_style not in {"'", '"'}:
            raise InvalidImportNode(
                f"Unsupported quote style: {quote_style!r}"
            )

        if not isinstance(named_payload, Sequence) or isinstance(
            named_payload,
            (str, bytes),
        ):
            raise InvalidImportNode(
                "namedImports must be a sequence"
            )

        named_imports = tuple(
            NamedImportNode.from_payload(item)
            for item in named_payload
            if isinstance(item, Mapping)
        )

        return cls(
            module=module,
            quote_style=quote_style,
            side_effect_only=bool(
                payload.get("sideEffectOnly")
            ),
            default_import=_optional_string(
                payload,
                "defaultImport",
            ),
            namespace_import=_optional_string(
                payload,
                "namespaceImport",
            ),
            named_imports=named_imports,
            type_only=bool(payload.get("typeOnly")),
            import_clause_start=_optional_int(
                payload,
                "importClauseStart",
            ),
            import_clause_end=_optional_int(
                payload,
                "importClauseEnd",
            ),
            named_bindings_start=_optional_int(
                payload,
                "namedBindingsStart",
            ),
            named_bindings_end=_optional_int(
                payload,
                "namedBindingsEnd",
            ),
            module_specifier_start=_required_int(
                payload,
                "moduleSpecifierStart",
            ),
            module_specifier_end=_required_int(
                payload,
                "moduleSpecifierEnd",
            ),
            start=_required_int(payload, "start"),
            end=_required_int(payload, "end"),
            start_line=_required_int(
                payload,
                "startLine",
            ),
            start_column=_required_int(
                payload,
                "startColumn",
            ),
            end_line=_required_int(
                payload,
                "endLine",
            ),
            end_column=_required_int(
                payload,
                "endColumn",
            ),
        )

    def contains_local(self, symbol: str) -> bool:
        return (
            self.default_import == symbol
            or self.namespace_import == symbol
            or any(
                item.matches_local(symbol)
                for item in self.named_imports
            )
        )

    def contains_imported(self, symbol: str) -> bool:
        return any(
            item.matches_imported(symbol)
            for item in self.named_imports
        )

    def named_import(
        self,
        local_name: str,
    ) -> NamedImportNode | None:
        return next(
            (
                item
                for item in self.named_imports
                if item.local == local_name
            ),
            None,
        )
