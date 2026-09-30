from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "008B",
    "name": "Atlas Dependency Analyzer",
    "version": "0.8.1",
    "requires": ["006A", "007A", "008A"],
    "description": (
        "Adds TypeScript dependency scanning for constructor injection "
        "and NestJS module metadata."
    ),
    "build": [],
}


DEPENDENCY_SCANNER = r'''from __future__ import annotations

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
'''


DEPENDENCY_GRAPH = r'''from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dependency_scanner import ROOT, scan_repository


OUTPUT = ROOT / "tools" / "dependency-graph.json"


def build_graph() -> dict[str, Any]:
    scanned_files = scan_repository()

    classes: dict[str, dict[str, Any]] = {}
    modules: dict[str, dict[str, Any]] = {}
    reverse_dependencies: dict[str, list[str]] = defaultdict(list)

    for file_result in scanned_files:
        file_path = file_result["file"]

        for class_result in file_result["classes"]:
            class_name = class_result["name"]
            dependencies = class_result.get(
                "dependsOn",
                [],
            )

            classes[class_name] = {
                "file": file_path,
                "dependsOn": dependencies,
            }

            for dependency in dependencies:
                if class_name not in reverse_dependencies[dependency]:
                    reverse_dependencies[dependency].append(
                        class_name
                    )

            module_data = class_result.get("module")

            if module_data is not None:
                modules[class_name] = {
                    "file": file_path,
                    **module_data,
                }

    known_classes = set(classes)

    unresolved_dependencies = sorted(
        {
            dependency
            for class_data in classes.values()
            for dependency in class_data["dependsOn"]
            if dependency not in known_classes
        }
    )

    edge_count = sum(
        len(class_data["dependsOn"])
        for class_data in classes.values()
    )

    module_edge_count = sum(
        len(module_data["imports"])
        + len(module_data["controllers"])
        + len(module_data["providers"])
        + len(module_data["exports"])
        for module_data in modules.values()
    )

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(
            timezone.utc
        ).isoformat(),
        "repository": {
            "root": str(ROOT),
        },
        "classes": classes,
        "modules": modules,
        "reverseDependencies": {
            name: sorted(dependants)
            for name, dependants
            in sorted(reverse_dependencies.items())
        },
        "unresolvedDependencies": unresolved_dependencies,
        "statistics": {
            "scannedFileCount": len(scanned_files),
            "classCount": len(classes),
            "moduleCount": len(modules),
            "constructorDependencyCount": edge_count,
            "moduleReferenceCount": module_edge_count,
            "unresolvedDependencyCount": len(
                unresolved_dependencies
            ),
        },
    }


def main() -> int:
    graph = build_graph()

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    OUTPUT.write_text(
        json.dumps(
            graph,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    statistics = graph["statistics"]

    print("=" * 64)
    print("Atlas Dependency Analyzer")
    print("=" * 64)
    print(
        "Scanned files:",
        statistics["scannedFileCount"],
    )
    print(
        "Classes:",
        statistics["classCount"],
    )
    print(
        "Modules:",
        statistics["moduleCount"],
    )
    print(
        "Constructor dependencies:",
        statistics["constructorDependencyCount"],
    )
    print(
        "Module references:",
        statistics["moduleReferenceCount"],
    )
    print(
        "Unresolved dependencies:",
        statistics["unresolvedDependencyCount"],
    )
    print("-" * 64)

    top_dependencies = sorted(
        graph["reverseDependencies"].items(),
        key=lambda item: len(item[1]),
        reverse=True,
    )[:10]

    print("Most depended-on classes:")

    if not top_dependencies:
        print("  No constructor dependencies detected.")
    else:
        for dependency, dependants in top_dependencies:
            print(
                f"  {dependency:<36} "
                f"{len(dependants)} dependant(s)"
            )

    print("-" * 64)
    print(
        "Graph:",
        OUTPUT.relative_to(ROOT).as_posix(),
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/dependency_scanner.py",
        DEPENDENCY_SCANNER,
    )

    context.write_text(
        "tools/dependency_graph.py",
        DEPENDENCY_GRAPH,
    )

    context.append_once(
        ".gitignore",
        """
# Atlas dependency analyzer generated output
tools/dependency-graph.json
""",
    )
