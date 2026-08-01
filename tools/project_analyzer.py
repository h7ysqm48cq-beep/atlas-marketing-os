from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tools" / "project-manifest.json"

CLASS_PATTERN = re.compile(
    r"export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)"
)

IMPORT_PATTERN = re.compile(
    r"""from\s+['"]([^'"]+)['"]"""
)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return {
            "_error": f"Invalid JSON: {error}",
        }

    return value if isinstance(value, dict) else {}


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def package_manager() -> str:
    if (ROOT / "pnpm-lock.yaml").exists():
        return "pnpm"

    if (ROOT / "yarn.lock").exists():
        return "yarn"

    return "npm"


def detect_build_command() -> list[str] | None:
    manager = package_manager()

    root_package = read_json(ROOT / "package.json")
    api_package = read_json(ROOT / "apps" / "api" / "package.json")

    root_scripts = root_package.get("scripts", {})
    api_scripts = api_package.get("scripts", {})

    if not isinstance(root_scripts, dict):
        root_scripts = {}

    if not isinstance(api_scripts, dict):
        api_scripts = {}

    if "build:api" in root_scripts:
        return [manager, "run", "build:api"]

    if "build" in api_scripts:
        if manager == "npm":
            return [
                "npm",
                "--prefix",
                "apps/api",
                "run",
                "build",
            ]

        if manager == "pnpm":
            return [
                "pnpm",
                "--dir",
                "apps/api",
                "run",
                "build",
            ]

        return [
            "yarn",
            "--cwd",
            "apps/api",
            "build",
        ]

    if "build" in root_scripts:
        return [manager, "run", "build"]

    return None


def discover_workspaces() -> list[dict[str, Any]]:
    workspaces: list[dict[str, Any]] = []

    for package_path in sorted(ROOT.glob("apps/*/package.json")):
        package = read_json(package_path)
        directory = package_path.parent

        workspaces.append(
            {
                "name": package.get("name", directory.name),
                "path": relative(directory),
                "scripts": package.get("scripts", {}),
            }
        )

    return workspaces


def classify_class(name: str) -> str | None:
    if name.endswith("Module"):
        return "module"

    if name.endswith("Controller"):
        return "controller"

    if name.endswith("Service"):
        return "service"

    if name.endswith("Guard"):
        return "guard"

    if name.endswith("Gateway"):
        return "gateway"

    return None


def scan_typescript() -> tuple[
    list[dict[str, str]],
    list[dict[str, str]],
]:
    symbols: list[dict[str, str]] = []
    imports: list[dict[str, str]] = []

    source_roots = [
        ROOT / "apps" / "api" / "src",
        ROOT / "apps" / "web" / "src",
    ]

    for source_root in source_roots:
        if not source_root.exists():
            continue

        for path in sorted(source_root.rglob("*.ts")):
            if path.name.endswith(".d.ts"):
                continue

            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue

            file_path = relative(path)

            for class_name in CLASS_PATTERN.findall(text):
                symbol_type = classify_class(class_name)

                if symbol_type:
                    symbols.append(
                        {
                            "name": class_name,
                            "type": symbol_type,
                            "file": file_path,
                        }
                    )

            for import_path in IMPORT_PATTERN.findall(text):
                if import_path.startswith("."):
                    imports.append(
                        {
                            "file": file_path,
                            "imports": import_path,
                        }
                    )

    return symbols, imports


def detect_capabilities(
    symbols: list[dict[str, str]],
) -> dict[str, bool]:
    names = {
        item["name"].lower()
        for item in symbols
    }

    files = {
        item["file"].lower()
        for item in symbols
    }

    combined = names | files

    return {
        "brain": any("brain" in value for value in combined),
        "copilot": any("copilot" in value for value in combined),
        "promptPipeline": any(
            "prompt" in value
            for value in combined
        ),
        "knowledge": any(
            "knowledge" in value
            for value in combined
        ),
        "memory": any(
            "memory" in value
            for value in combined
        ),
        "automation": any(
            "automation" in value
            for value in combined
        ),
        "publishing": any(
            "publish" in value
            for value in combined
        ),
    }


def build_manifest() -> dict[str, Any]:
    root_package = read_json(ROOT / "package.json")
    workspaces = discover_workspaces()
    symbols, imports = scan_typescript()

    grouped = {
        "modules": [],
        "controllers": [],
        "services": [],
        "guards": [],
        "gateways": [],
    }

    plural = {
        "module": "modules",
        "controller": "controllers",
        "service": "services",
        "guard": "guards",
        "gateway": "gateways",
    }

    for symbol in symbols:
        target = plural.get(symbol["type"])

        if target:
            grouped[target].append(symbol)

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(
            timezone.utc
        ).isoformat(),
        "repository": {
            "name": root_package.get(
                "name",
                ROOT.name,
            ),
            "root": str(ROOT),
            "packageManager": package_manager(),
        },
        "frameworks": {
            "api": "NestJS"
            if (ROOT / "apps" / "api" / "nest-cli.json").exists()
            else "unknown",
            "web": "Next.js"
            if (ROOT / "apps" / "web" / "next.config.js").exists()
            or (ROOT / "apps" / "web" / "next.config.mjs").exists()
            or (ROOT / "apps" / "web" / "next.config.ts").exists()
            else "unknown",
        },
        "commands": {
            "buildApi": detect_build_command(),
            "rootScripts": root_package.get("scripts", {}),
        },
        "workspaces": workspaces,
        "architecture": grouped,
        "capabilities": detect_capabilities(symbols),
        "dependencyHints": imports,
        "statistics": {
            "workspaceCount": len(workspaces),
            "moduleCount": len(grouped["modules"]),
            "controllerCount": len(grouped["controllers"]),
            "serviceCount": len(grouped["services"]),
            "guardCount": len(grouped["guards"]),
            "gatewayCount": len(grouped["gateways"]),
            "relativeImportCount": len(imports),
        },
    }


def main() -> int:
    manifest = build_manifest()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            manifest,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    statistics = manifest["statistics"]
    build_command = manifest["commands"]["buildApi"]

    print("=" * 64)
    print("Atlas Project Analyzer")
    print("=" * 64)
    print(
        "Repository:",
        manifest["repository"]["name"],
    )
    print(
        "Package manager:",
        manifest["repository"]["packageManager"],
    )
    print(
        "API framework:",
        manifest["frameworks"]["api"],
    )
    print(
        "Web framework:",
        manifest["frameworks"]["web"],
    )
    print(
        "Build command:",
        " ".join(build_command)
        if build_command
        else "Not detected",
    )
    print(
        "Modules:",
        statistics["moduleCount"],
    )
    print(
        "Controllers:",
        statistics["controllerCount"],
    )
    print(
        "Services:",
        statistics["serviceCount"],
    )
    print(
        "Relative imports:",
        statistics["relativeImportCount"],
    )
    print("-" * 64)

    for capability, detected in manifest["capabilities"].items():
        status = "YES" if detected else "NO"
        print(f"{capability:<20} {status}")

    print("-" * 64)
    print(
        "Manifest:",
        relative(OUTPUT),
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
