from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    CreateFile,
)

from .base import BaseTypeScriptExecutor


@dataclass(
    slots=True,
    frozen=True,
)
class CreateFileExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class CreateFileExecutor(
    BaseTypeScriptExecutor,
):
    """
    Create a source file without silently overwriting
    existing project content.
    """

    def __init__(
        self,
        *,
        project_root: str | Path = ".",
        dry_run: bool = False,
        show_preview: bool = True,
    ) -> None:
        super().__init__(
            project_root=project_root,
            dry_run=dry_run,
            show_preview=show_preview,
        )

        self.last_result: (
            CreateFileExecutionResult | None
        ) = None

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            CreateFile,
        ):
            raise TypeError(
                "CreateFileExecutor expected "
                "CreateFile, received "
                f"{type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path
        )

        content = action.content

        if not isinstance(content, str):
            raise TypeError(
                "CreateFile content must be a string"
            )

        if not content:
            raise ValueError(
                "CreateFile content cannot be empty"
            )

        existed = target.exists()

        if existed:
            if not target.is_file():
                raise RuntimeError(
                    "CreateFile target exists but "
                    f"is not a file: {target}"
                )

            original = target.read_text(
                encoding="utf-8",
            )

            if original == content:
                changed = False
                updated = original

            elif not action.overwrite:
                raise FileExistsError(
                    "Refusing to overwrite existing "
                    f"file: {action.file_path}"
                )

            else:
                changed = True
                updated = content

        else:
            original = ""
            updated = content
            changed = True

        preview = self.build_preview(
            target,
            original,
            updated,
        )

        saved = False

        if changed and not self.dry_run:
            target.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            target.write_text(
                updated,
                encoding="utf-8",
            )

            saved = True

        self.last_result = (
            CreateFileExecutionResult(
                file_path=str(target),
                changed=changed,
                saved=saved,
                preview=preview,
            )
        )

        relative = target.relative_to(
            self.project_root
        )

        print(
            "CREATE FILE -> "
            f"{relative}"
        )

        if not changed:
            print(
                "Result -> identical file already "
                "exists; no change required"
            )
            return

        self.print_preview(preview)

        if self.dry_run:
            print(
                "Result -> dry run; "
                "file was not created"
            )
        elif saved:
            print("Result -> file saved")
        else:
            print(
                "Result -> no file write required"
            )
