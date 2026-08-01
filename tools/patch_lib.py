from __future__ import annotations

import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


class PatchContext:
    def __init__(
        self,
        root: Path,
        patch_id: str,
        dry_run: bool = False,
    ) -> None:
        self.root = root.resolve()
        self.patch_id = patch_id
        self.dry_run = dry_run
        self.changed_files: set[Path] = set()

        timestamp = time.strftime("%Y%m%d-%H%M%S")
        self.backup_root = (
            self.root
            / "tools"
            / "backups"
            / f"{patch_id}-{timestamp}"
        )

    def resolve(self, relative_path: str | Path) -> Path:
        path = (self.root / relative_path).resolve()

        if self.root not in path.parents and path != self.root:
            raise PatchError(
                f"Path escapes repository root: {relative_path}"
            )

        return path

    def backup(self, relative_path: str | Path) -> None:
        source = self.resolve(relative_path)

        if not source.exists():
            return

        destination = (
            self.backup_root
            / source.relative_to(self.root)
        )

        if self.dry_run:
            print(
                f"[dry-run] backup {source.relative_to(self.root)}"
            )
            return

        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        if source.is_dir():
            shutil.copytree(
                source,
                destination,
                dirs_exist_ok=True,
            )
        else:
            shutil.copy2(source, destination)

    def write_text(
        self,
        relative_path: str | Path,
        content: str,
    ) -> bool:
        path = self.resolve(relative_path)
        current = (
            path.read_text(encoding="utf-8")
            if path.exists()
            else None
        )

        if current == content:
            print(f"Unchanged: {relative_path}")
            return False

        self.backup(relative_path)

        if self.dry_run:
            action = "Update" if path.exists() else "Create"
            print(f"[dry-run] {action}: {relative_path}")
            return True

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        self.changed_files.add(path)

        action = "Updated" if current is not None else "Created"
        print(f"{action}: {relative_path}")
        return True

    def replace_once(
        self,
        relative_path: str | Path,
        old: str,
        new: str,
        *,
        required: bool = True,
    ) -> bool:
        path = self.resolve(relative_path)

        if not path.exists():
            raise PatchError(f"File not found: {relative_path}")

        text = path.read_text(encoding="utf-8")

        if new in text:
            print(f"Already applied: {relative_path}")
            return False

        count = text.count(old)

        if count == 0:
            if required:
                raise PatchError(
                    f"Expected marker not found in {relative_path}"
                )
            return False

        if count > 1:
            raise PatchError(
                f"Marker appears {count} times in {relative_path}"
            )

        return self.write_text(
            relative_path,
            text.replace(old, new, 1),
        )

    def append_once(
        self,
        relative_path: str | Path,
        block: str,
    ) -> bool:
        path = self.resolve(relative_path)
        text = (
            path.read_text(encoding="utf-8")
            if path.exists()
            else ""
        )

        normalized_block = block.strip()

        if normalized_block in text:
            print(f"Already present: {relative_path}")
            return False

        updated = text.rstrip()

        if updated:
            updated += "\n\n"

        updated += normalized_block + "\n"

        return self.write_text(relative_path, updated)

    def run(
        self,
        command: Iterable[str],
        *,
        check: bool = True,
    ) -> CommandResult:
        command_list = list(command)
        printable = " ".join(command_list)

        if self.dry_run:
            print(f"[dry-run] run: {printable}")
            return CommandResult(
                command=command_list,
                returncode=0,
                stdout="",
                stderr="",
            )

        print(f"\n$ {printable}")

        process = subprocess.run(
            command_list,
            cwd=self.root,
            text=True,
            capture_output=True,
        )

        if process.stdout:
            print(process.stdout, end="")

        if process.stderr:
            print(process.stderr, end="")

        result = CommandResult(
            command=command_list,
            returncode=process.returncode,
            stdout=process.stdout,
            stderr=process.stderr,
        )

        if check and process.returncode != 0:
            raise PatchError(
                f"Command failed ({process.returncode}): "
                f"{printable}"
            )

        return result

    def save_metadata(
        self,
        manifest: dict,
    ) -> None:
        if self.dry_run:
            return

        self.backup_root.mkdir(
            parents=True,
            exist_ok=True,
        )

        metadata = {
            "patch": manifest,
            "changedFiles": sorted(
                str(path.relative_to(self.root))
                for path in self.changed_files
            ),
            "createdAt": time.strftime(
                "%Y-%m-%dT%H:%M:%S"
            ),
        }

        (
            self.backup_root / "metadata.json"
        ).write_text(
            json.dumps(
                metadata,
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )

    def restore_backup(self) -> None:
        if not self.backup_root.exists():
            raise PatchError(
                f"Backup not found: {self.backup_root}"
            )

        for source in self.backup_root.rglob("*"):
            if (
                not source.is_file()
                or source.name == "metadata.json"
            ):
                continue

            relative = source.relative_to(self.backup_root)
            destination = self.root / relative
            destination.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            shutil.copy2(source, destination)
            print(f"Restored: {relative}")
