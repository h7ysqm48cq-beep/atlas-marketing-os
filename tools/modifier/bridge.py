from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(
    frozen=True,
    slots=True,
)
class WorkspaceRenameEdit:
    start: int
    end: int
    text: str
    prefix: str = ""
    suffix: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "prefix": self.prefix,
            "suffix": self.suffix,
        }


@dataclass(
    frozen=True,
    slots=True,
)
class WorkspaceRenameFile:
    file_path: str
    edits: tuple[
        WorkspaceRenameEdit,
        ...,
    ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_path": self.file_path,
            "edits": [
                edit.to_dict()
                for edit in self.edits
            ],
        }


@dataclass(
    frozen=True,
    slots=True,
)
class WorkspaceRenameResult:
    project_root: str
    target_file: str
    old_name: str
    new_name: str
    total_locations: int
    files: tuple[
        WorkspaceRenameFile,
        ...,
    ]
    config_path: str | None = None

    @property
    def ok(self) -> bool:
        return True

    @property
    def total_files(self) -> int:
        return len(self.files)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": True,
            "project_root": self.project_root,
            "config_path": self.config_path,
            "target_file": self.target_file,
            "old_name": self.old_name,
            "new_name": self.new_name,
            "total_locations": (
                self.total_locations
            ),
            "total_files": self.total_files,
            "files": [
                file.to_dict()
                for file in self.files
            ],
        }


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
        workspace_rename_path: (
            str | Path | None
        ) = None,
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

        self.workspace_rename_path = (
            Path(
                workspace_rename_path
            ).resolve()
            if workspace_rename_path
            is not None
            else (
                self.project_root
                / "tools"
                / "modifier"
                / "workspace_rename.js"
            )
        )

        if not self.workspace_rename_path.exists():
            raise TypeScriptBridgeError(
                "Workspace rename script "
                "does not exist: "
                f"{self.workspace_rename_path}"
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

    def workspace_rename(
        self,
        target_file: str | Path,
        old_name: str,
        new_name: str,
    ) -> WorkspaceRenameResult:
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

        resolved_target = self.resolve(
            target_file
        )

        if not resolved_target.exists():
            raise TypeScriptBridgeError(
                "Workspace rename target "
                "does not exist: "
                f"{resolved_target}"
            )

        if resolved_target.suffix not in {
            ".ts",
            ".tsx",
        }:
            raise TypeScriptBridgeError(
                "Workspace rename target must "
                "be .ts or .tsx: "
                f"{resolved_target}"
            )

        process = subprocess.run(
            [
                self.node_command,
                str(
                    self.workspace_rename_path
                ),
                str(self.project_root),
                str(resolved_target),
                old_name,
                new_name,
            ],
            cwd=self.project_root,
            text=True,
            capture_output=True,
            check=False,
        )

        output = process.stdout.strip()

        if not output:
            raise TypeScriptBridgeError(
                "Workspace rename produced "
                "no output.\n"
                f"stderr: "
                f"{process.stderr.strip()}"
            )

        try:
            payload = json.loads(output)
        except json.JSONDecodeError as error:
            raise TypeScriptBridgeError(
                "Workspace rename returned "
                "invalid JSON.\n"
                f"stdout: {output[:1000]}\n"
                f"stderr: "
                f"{process.stderr.strip()}"
            ) from error

        if (
            process.returncode != 0
            or not payload.get("ok")
        ):
            raise TypeScriptBridgeError(
                payload.get(
                    "error",
                    "Workspace rename failed.",
                )
            )

        raw_files = payload.get(
            "files",
            [],
        )

        if not isinstance(raw_files, list):
            raise TypeScriptBridgeError(
                "Workspace rename files must "
                "be a list"
            )

        files: list[
            WorkspaceRenameFile
        ] = []

        for raw_file in raw_files:
            if not isinstance(
                raw_file,
                dict,
            ):
                raise TypeScriptBridgeError(
                    "Workspace rename file "
                    "entry must be an object"
                )

            file_path = raw_file.get(
                "filePath"
            )

            if not isinstance(
                file_path,
                str,
            ) or not file_path:
                raise TypeScriptBridgeError(
                    "Workspace rename filePath "
                    "must be a non-empty string"
                )

            raw_edits = raw_file.get(
                "edits",
                [],
            )

            if not isinstance(
                raw_edits,
                list,
            ):
                raise TypeScriptBridgeError(
                    "Workspace rename edits "
                    "must be a list"
                )

            edits: list[
                WorkspaceRenameEdit
            ] = []

            for raw_edit in raw_edits:
                if not isinstance(
                    raw_edit,
                    dict,
                ):
                    raise (
                        TypeScriptBridgeError(
                            "Workspace rename edit "
                            "must be an object"
                        )
                    )

                start = raw_edit.get(
                    "start"
                )
                end = raw_edit.get(
                    "end"
                )
                replacement = raw_edit.get(
                    "text"
                )

                if (
                    isinstance(start, bool)
                    or not isinstance(
                        start,
                        int,
                    )
                    or start < 0
                ):
                    raise (
                        TypeScriptBridgeError(
                            "Workspace rename "
                            "edit start is invalid"
                        )
                    )

                if (
                    isinstance(end, bool)
                    or not isinstance(
                        end,
                        int,
                    )
                    or end < start
                ):
                    raise (
                        TypeScriptBridgeError(
                            "Workspace rename "
                            "edit end is invalid"
                        )
                    )

                if not isinstance(
                    replacement,
                    str,
                ):
                    raise (
                        TypeScriptBridgeError(
                            "Workspace rename "
                            "edit text must be "
                            "a string"
                        )
                    )

                edits.append(
                    WorkspaceRenameEdit(
                        start=start,
                        end=end,
                        text=replacement,
                        prefix=raw_edit.get(
                            "prefix",
                            "",
                        ),
                        suffix=raw_edit.get(
                            "suffix",
                            "",
                        ),
                    )
                )

            files.append(
                WorkspaceRenameFile(
                    file_path=file_path,
                    edits=tuple(edits),
                )
            )

        return WorkspaceRenameResult(
            project_root=str(
                payload.get(
                    "projectRoot",
                    self.project_root,
                )
            ),
            config_path=(
                str(payload["configPath"])
                if payload.get(
                    "configPath"
                )
                else None
            ),
            target_file=str(
                payload.get(
                    "targetFile",
                    resolved_target.relative_to(
                        self.project_root
                    ).as_posix(),
                )
            ),
            old_name=str(
                payload.get(
                    "oldName",
                    old_name,
                )
            ),
            new_name=str(
                payload.get(
                    "newName",
                    new_name,
                )
            ),
            total_locations=int(
                payload.get(
                    "totalLocations",
                    sum(
                        len(file.edits)
                        for file in files
                    ),
                )
            ),
            files=tuple(files),
        )

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


def main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(
        description="Atlas TypeScript AST Bridge"
    )

    parser.add_argument(
        "--file",
        required=True,
        help="TypeScript file path",
    )

    parser.add_argument(
        "--project",
        default=".",
        help="Repository root",
    )

    args = parser.parse_args()

    bridge = TypeScriptBridge(
        project_root=args.project,
    )

    result = bridge.parse(
        args.file,
    )

    print(
        json.dumps(
            result.raw,
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
