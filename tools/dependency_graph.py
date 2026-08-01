from __future__ import annotations

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
