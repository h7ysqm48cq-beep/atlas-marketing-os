from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import Action, AddImport
from tools.modifier.typescript import TypeScriptFile

from .base import BaseTypeScriptExecutor


@dataclass(slots=True, frozen=True)
class ImportExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class AddImportExecutor(BaseTypeScriptExecutor):
    """
    Real executor for Atlas AddImport actions.

    Common TypeScript executor behavior is inherited from
    BaseTypeScriptExecutor.
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
        self.last_result: ImportExecutionResult | None = None

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(action, AddImport):
            raise TypeError(
                "AddImportExecutor expected AddImport, "
                f"received {type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path,
        )

        if not target.exists():
            raise FileNotFoundError(
                f"TypeScript file does not exist: {target}"
            )

        if target.suffix not in {".ts", ".tsx"}:
            raise RuntimeError(
                f"Expected .ts or .tsx file: {target}"
            )

        original_text = target.read_text(
            encoding="utf-8",
        )

        source = TypeScriptFile.load(target)

        changed = source.add_import(
            action.symbol,
            action.module,
            default=action.default,
        )

        updated_text = source.source()

        preview = self.build_preview(
            target,
            original_text,
            updated_text,
        )

        saved = False

        if changed and not self.dry_run:
            saved = source.save()

        self.last_result = ImportExecutionResult(
            file_path=str(target),
            changed=changed,
            saved=saved,
            preview=preview,
        )

        relative = target.relative_to(
            self.project_root,
        )

        print(
            f"ADD IMPORT -> "
            f"{action.symbol} from "
            f"{action.module}"
        )
        print(f"Target -> {relative}")

        if not changed:
            print(
                "Result -> already present; "
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
