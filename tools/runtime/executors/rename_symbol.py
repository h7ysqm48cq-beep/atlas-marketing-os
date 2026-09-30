from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    RenameSymbol,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)

from .base import BaseTypeScriptExecutor


@dataclass(
    slots=True,
    frozen=True,
)
class RenameSymbolExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class RenameSymbolExecutor(
    BaseTypeScriptExecutor,
):
    """
    Rename one declaration and its in-file
    TypeScript Language Service references.
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
            RenameSymbolExecutionResult | None
        ) = None

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            RenameSymbol,
        ):
            raise TypeError(
                "RenameSymbolExecutor expected "
                "RenameSymbol, received "
                f"{type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path
        )

        if not target.exists():
            raise FileNotFoundError(
                "TypeScript file does not exist: "
                f"{target}"
            )

        original = target.read_text(
            encoding="utf-8",
        )

        source_file = TypeScriptFile.load(
            target
        )

        changed = (
            source_file.rename_declaration(
                action.old_name,
                action.new_name,
            )
        )

        updated = source_file.source()

        preview = self.build_preview(
            target,
            original,
            updated,
        )

        saved = False

        if changed and not self.dry_run:
            saved = source_file.save()

        self.last_result = (
            RenameSymbolExecutionResult(
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
            "RENAME SYMBOL -> "
            f"{action.old_name} -> "
            f"{action.new_name}"
        )
        print(f"Target -> {relative}")

        if not changed:
            print(
                "Result -> symbol not found or "
                "no change required"
            )
            return

        self.print_preview(preview)

        if self.dry_run:
            print(
                "Result -> dry run; "
                "file was not saved"
            )
        elif saved:
            print("Result -> file saved")
        else:
            print(
                "Result -> no file write required"
            )
