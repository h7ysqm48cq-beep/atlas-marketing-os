from __future__ import annotations

import re
from dataclasses import dataclass

from .ast_navigator import RenameSymbolNode


IDENTIFIER_PATTERN = re.compile(
    r"^[A-Za-z_$][A-Za-z0-9_$]*$"
)


TYPESCRIPT_RESERVED_WORDS = {
    "abstract",
    "any",
    "as",
    "asserts",
    "async",
    "await",
    "bigint",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "constructor",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "global",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "instanceof",
    "interface",
    "intrinsic",
    "is",
    "keyof",
    "let",
    "module",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "object",
    "of",
    "package",
    "private",
    "protected",
    "public",
    "readonly",
    "require",
    "return",
    "satisfies",
    "set",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unique",
    "unknown",
    "using",
    "var",
    "void",
    "while",
    "with",
    "yield",
}


class DeclarationRenameError(ValueError):
    """Base declaration rename error."""


class InvalidDeclarationName(
    DeclarationRenameError
):
    """Raised when the replacement is not an identifier."""


class DeclarationRenameConflict(
    DeclarationRenameError
):
    """Raised when the new name already exists."""


@dataclass(frozen=True, slots=True)
class DeclarationRenameEdit:
    start: int
    end: int
    text: str


@dataclass(frozen=True, slots=True)
class DeclarationRenamePlan:
    edits: tuple[DeclarationRenameEdit, ...]
    old_name: str
    new_name: str
    kind: str


@dataclass(frozen=True, slots=True)
class DeclarationRenameContext:
    symbol: RenameSymbolNode
    new_name: str
    existing_declaration_names: tuple[str, ...]


class DeclarationRenamePlanner:
    def plan(
        self,
        context: DeclarationRenameContext,
    ) -> DeclarationRenamePlan | None:
        if not isinstance(
            context,
            DeclarationRenameContext,
        ):
            raise TypeError(
                "context must be a "
                "DeclarationRenameContext"
            )

        new_name = context.new_name

        if (
            not IDENTIFIER_PATTERN.fullmatch(
                new_name
            )
            or new_name
            in TYPESCRIPT_RESERVED_WORDS
        ):
            raise InvalidDeclarationName(
                f"{new_name!r} is not a supported "
                "TypeScript identifier"
            )

        old_name = context.symbol.name

        if old_name == new_name:
            return None

        if new_name in {
            name
            for name in context.existing_declaration_names
            if name != old_name
        }:
            raise DeclarationRenameConflict(
                f"A declaration named "
                f"{new_name!r} already exists"
            )

        occurrences = (
            context.symbol.occurrences
        )

        if not occurrences:
            raise DeclarationRenameError(
                "TypeScript Language Service "
                "returned no rename locations"
            )

        edits = tuple(
            DeclarationRenameEdit(
                start=occurrence.start,
                end=occurrence.end,
                text=new_name,
            )
            for occurrence in occurrences
        )

        return DeclarationRenamePlan(
            edits=edits,
            old_name=old_name,
            new_name=new_name,
            kind=context.symbol.kind,
        )
