from __future__ import annotations

import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
API_SOURCE = ROOT / "apps" / "api" / "src"

CLASS_PATTERN = re.compile(
    r"export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)"
)

IDENTIFIER_PATTERN = re.compile(
    r"\b[A-Za-z_][A-Za-z0-9_]*\b"
)

PARAMETER_TYPE_PATTERN = re.compile(
    r"""
    (?:
        @Inject\([^)]*\)\s*
    )?
    (?:
        private|public|protected|readonly|\s
    )*
    [A-Za-z_][A-Za-z0-9_]*\s*
    \??\s*:\s*
    ([A-Za-z_][A-Za-z0-9_]*)
    """,
    re.VERBOSE,
)

IGNORED_TYPES = {
    "string",
    "number",
    "boolean",
    "object",
    "unknown",
    "any",
    "Record",
    "Array",
    "Promise",
    "Date",
}


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return ""


def find_matching(
    text: str,
    opening_index: int,
    opening: str,
    closing: str,
) -> int | None:
    depth = 0
    quote: str | None = None
    escaped = False

    for index in range(opening_index, len(text)):
        character = text[index]

        if escaped:
            escaped = False
            continue

        if character == "\\":
            escaped = True
            continue

        if quote:
            if character == quote:
                quote = None
            continue

        if character in {"'", '"', "`"}:
            quote = character
            continue

        if character == opening:
            depth += 1
        elif character == closing:
            depth -= 1

            if depth == 0:
                return index

    return None


def extract_class_body(
    text: str,
    class_match: re.Match[str],
) -> str:
    opening_index = text.find("{", class_match.end())

    if opening_index == -1:
        return ""

    closing_index = find_matching(
        text,
        opening_index,
        "{",
        "}",
    )

    if closing_index is None:
        return ""

    return text[opening_index + 1:closing_index]


def extract_constructor_dependencies(
    class_body: str,
) -> list[str]:
    constructor_match = re.search(
        r"\bconstructor\s*\(",
        class_body,
    )

    if not constructor_match:
        return []

    opening_index = class_body.find(
        "(",
        constructor_match.start(),
    )

    if opening_index == -1:
        return []

    closing_index = find_matching(
        class_body,
        opening_index,
        "(",
        ")",
    )

    if closing_index is None:
        return []

    parameters = class_body[
        opening_index + 1:closing_index
    ]

    dependencies: list[str] = []

    for dependency in PARAMETER_TYPE_PATTERN.findall(parameters):
        if dependency in IGNORED_TYPES:
            continue

        if dependency not in dependencies:
            dependencies.append(dependency)

    return dependencies


def extract_decorator_object(
    text: str,
    decorator_name: str,
    before_index: int,
) -> str:
    prefix = text[:before_index]
    marker = f"@{decorator_name}"
    decorator_index = prefix.rfind(marker)

    if decorator_index == -1:
        return ""

    opening_parenthesis = text.find(
        "(",
        decorator_index,
        before_index,
    )

    if opening_parenthesis == -1:
        return ""

    closing_parenthesis = find_matching(
        text,
        opening_parenthesis,
        "(",
        ")",
    )

    if (
        closing_parenthesis is None
        or closing_parenthesis > before_index
    ):
        return ""

    return text[
        opening_parenthesis + 1:closing_parenthesis
    ]


def extract_array_property(
    object_text: str,
    property_name: str,
) -> list[str]:
    property_match = re.search(
        rf"\b{re.escape(property_name)}\s*:",
        object_text,
    )

    if not property_match:
        return []

    opening_index = object_text.find(
        "[",
        property_match.end(),
    )

    if opening_index == -1:
        return []

    closing_index = find_matching(
        object_text,
        opening_index,
        "[",
        "]",
    )

    if closing_index is None:
        return []

    array_text = object_text[
        opening_index + 1:closing_index
    ]

    excluded = {
        "forwardRef",
        "true",
        "false",
        "undefined",
        "null",
    }

    results: list[str] = []

    for identifier in IDENTIFIER_PATTERN.findall(array_text):
        if identifier in excluded:
            continue

        if identifier not in results:
            results.append(identifier)

    return results


def scan_file(path: Path) -> dict[str, Any]:
    text = read_text(path)

    result: dict[str, Any] = {
        "file": relative(path),
        "classes": [],
    }

    if not text:
        return result

    for class_match in CLASS_PATTERN.finditer(text):
        class_name = class_match.group(1)
        class_body = extract_class_body(
            text,
            class_match,
        )

        class_data: dict[str, Any] = {
            "name": class_name,
            "dependsOn": extract_constructor_dependencies(
                class_body
            ),
        }

        if class_name.endswith("Module"):
            module_object = extract_decorator_object(
                text,
                "Module",
                class_match.start(),
            )

            class_data["module"] = {
                "imports": extract_array_property(
                    module_object,
                    "imports",
                ),
                "controllers": extract_array_property(
                    module_object,
                    "controllers",
                ),
                "providers": extract_array_property(
                    module_object,
                    "providers",
                ),
                "exports": extract_array_property(
                    module_object,
                    "exports",
                ),
            }

        result["classes"].append(class_data)

    return result


def scan_repository() -> list[dict[str, Any]]:
    if not API_SOURCE.exists():
        return []

    results: list[dict[str, Any]] = []

    for path in sorted(API_SOURCE.rglob("*.ts")):
        if path.name.endswith(".d.ts"):
            continue

        result = scan_file(path)

        if result["classes"]:
            results.append(result)

    return results
