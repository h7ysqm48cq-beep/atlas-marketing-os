from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class TypeScriptBridgeError(RuntimeError):
    """Raised when the TypeScript AST bridge fails."""


@dataclass(frozen=True)
class BridgeResult:
    file: dict[str, Any]
    imports: list[dict[str, Any]]
    exports: list[dict[str, Any]]
    declarations: list[dict[str, Any]]
    exported_declarations: list[dict[str, Any]]
    rename_symbols: list[dict[str, Any]]
    member_rename_symbols: list[dict[str, Any]]
    classes: list[dict[str, Any]]
    diagnostics: list[dict[str, Any]]
    statistics: dict[str, int]
    raw: dict[str, Any]

    @property
    def ok(self) -> bool:
        return bool(self.raw.get("ok"))

    def find_class(
        self,
        name: str,
    ) -> dict[str, Any] | None:
        return next(
            (
                item
                for item in self.classes
                if item.get("name") == name
            ),
            None,
        )


class TypeScriptBridge:
    def __init__(
        self,
        *,
        project_root: str | Path = ".",
        node_command: str = "node",
        parser_path: str | Path | None = None,
    ) -> None:
        self.project_root = Path(project_root).resolve()
        self.node_command = node_command

        self.parser_path = (
            Path(parser_path).resolve()
            if parser_path is not None
            else (
                self.project_root
                / "tools"
                / "modifier"
                / "parser.js"
            )
        )

        if not self.parser_path.exists():
            raise TypeScriptBridgeError(
                f"Parser does not exist: {self.parser_path}"
            )

    def resolve(
        self,
        file_path: str | Path,
    ) -> Path:
        candidate = Path(file_path)

        if not candidate.is_absolute():
            candidate = self.project_root / candidate

        resolved = candidate.resolve()

        try:
            resolved.relative_to(self.project_root)
        except ValueError as error:
            raise TypeScriptBridgeError(
                f"File escapes project root: {file_path}"
            ) from error

        return resolved

    def parse_source(
        self,
        source: str,
        *,
        suffix: str = ".ts",
    ) -> BridgeResult:
        """
        Parse TypeScript source currently held in memory.

        A temporary file is created inside project_root so the
        existing parser.js path and project resolution rules remain
        unchanged. The temporary file is always removed.
        """

        if not isinstance(source, str):
            raise TypeError(
                "source must be a string"
            )

        if suffix not in {".ts", ".tsx"}:
            raise TypeScriptBridgeError(
                f"Expected .ts or .tsx suffix: {suffix}"
            )

        temporary_path: Path | None = None

        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                suffix=suffix,
                prefix=".atlas-bridge-",
                dir=self.project_root,
                delete=False,
            ) as temporary:
                temporary.write(source)
                temporary.flush()

                temporary_path = Path(
                    temporary.name
                )

            return self.parse(
                temporary_path
            )
        finally:
            if (
                temporary_path is not None
                and temporary_path.exists()
            ):
                temporary_path.unlink()

    def parse(
        self,
        file_path: str | Path,
    ) -> BridgeResult:
        resolved = self.resolve(file_path)

        if not resolved.exists():
            raise TypeScriptBridgeError(
                f"TypeScript file does not exist: {resolved}"
            )

        if resolved.suffix not in {".ts", ".tsx"}:
            raise TypeScriptBridgeError(
                f"Expected .ts or .tsx file: {resolved}"
            )

        process = subprocess.run(
            [
                self.node_command,
                str(self.parser_path),
                str(resolved),
            ],
            cwd=self.project_root,
            text=True,
            capture_output=True,
            check=False,
        )

        output = process.stdout.strip()

        if not output:
            raise TypeScriptBridgeError(
                "TypeScript parser produced no output.\n"
                f"stderr: {process.stderr.strip()}"
            )

        try:
            payload = json.loads(output)
        except json.JSONDecodeError as error:
            raise TypeScriptBridgeError(
                "TypeScript parser returned invalid JSON.\n"
                f"stdout: {output[:1000]}\n"
                f"stderr: {process.stderr.strip()}"
            ) from error

        if process.returncode not in {0, 2}:
            raise TypeScriptBridgeError(
                payload.get(
                    "error",
                    "TypeScript parser failed.",
                )
            )

        if not isinstance(payload, dict):
            raise TypeScriptBridgeError(
                "Unexpected parser response."
            )

        return BridgeResult(
            file=payload.get("file", {}),
            imports=payload.get("imports", []),
            exports=payload.get("exports", []),
            declarations=payload.get(
                "declarations",
                [],
            ),
            exported_declarations=payload.get(
                "exportedDeclarations",
                [],
            ),
            rename_symbols=payload.get(
                "renameSymbols",
                [],
            ),
            member_rename_symbols=payload.get(
                "memberRenameSymbols",
                [],
            ),
            classes=payload.get("classes", []),
            diagnostics=payload.get("diagnostics", []),
            statistics=payload.get("statistics", {}),
            raw=payload,
        )
