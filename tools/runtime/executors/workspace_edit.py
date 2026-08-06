from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    WorkspaceEdit,
    WorkspaceFileEdit,
)

from .base import BaseTypeScriptExecutor


@dataclass(
    slots=True,
    frozen=True,
)
class WorkspaceFileExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


@dataclass(
    slots=True,
    frozen=True,
)
class WorkspaceEditExecutionResult:
    changed: bool
    saved: bool
    preview: str
    files: tuple[
        WorkspaceFileExecutionResult,
        ...,
    ]


class WorkspaceEditExecutor(
    BaseTypeScriptExecutor,
):
    """
    Apply validated text edits across multiple files.

    Edits are applied from the highest source offset
    to the lowest so earlier replacements do not shift
    the positions of later edits.
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
            WorkspaceEditExecutionResult | None
        ) = None

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            WorkspaceEdit,
        ):
            raise TypeError(
                "WorkspaceEditExecutor expected "
                "WorkspaceEdit, received "
                f"{type(action).__name__}"
            )

        pending: list[
            tuple[
                WorkspaceFileEdit,
                Path,
                str,
                str,
                str,
                bool,
            ]
        ] = []

        for file_edit in action.files:
            target = self.resolve_target(
                file_edit.file_path
            )

            if not target.exists():
                raise FileNotFoundError(
                    "Workspace edit target "
                    f"does not exist: {target}"
                )

            if not target.is_file():
                raise RuntimeError(
                    "Workspace edit target is "
                    f"not a file: {target}"
                )

            original = target.read_text(
                encoding="utf-8",
            )

            updated = self._apply_edits(
                original,
                file_edit,
            )

            changed = updated != original

            preview = self.build_preview(
                target,
                original,
                updated,
            )

            pending.append(
                (
                    file_edit,
                    target,
                    original,
                    updated,
                    preview,
                    changed,
                )
            )

        file_results: list[
            WorkspaceFileExecutionResult
        ] = []

        previews: list[str] = []

        for (
            file_edit,
            target,
            _original,
            updated,
            preview,
            changed,
        ) in pending:
            saved = False

            if changed and not self.dry_run:
                target.write_text(
                    updated,
                    encoding="utf-8",
                )
                saved = True

            if preview:
                previews.append(preview)

            file_results.append(
                WorkspaceFileExecutionResult(
                    file_path=(
                        file_edit.file_path
                    ),
                    changed=changed,
                    saved=saved,
                    preview=preview,
                )
            )

        combined_preview = "\n".join(
            preview.rstrip()
            for preview in previews
            if preview
        )

        changed = any(
            result.changed
            for result in file_results
        )

        saved = any(
            result.saved
            for result in file_results
        )

        self.last_result = (
            WorkspaceEditExecutionResult(
                changed=changed,
                saved=saved,
                preview=combined_preview,
                files=tuple(file_results),
            )
        )

        print(
            "WORKSPACE EDIT -> "
            f"{len(action.files)} files"
        )

        for result in file_results:
            status = (
                "changed"
                if result.changed
                else "unchanged"
            )

            print(
                f"- {result.file_path}: "
                f"{status}"
            )

        if not changed:
            print(
                "Result -> no changes required"
            )
            return

        self.print_preview(
            combined_preview
        )

        if self.dry_run:
            print(
                "Result -> dry run; "
                "no files were saved"
            )
        elif saved:
            print(
                "Result -> workspace files saved"
            )
        else:
            print(
                "Result -> no file write required"
            )

    @staticmethod
    def _apply_edits(
        source: str,
        file_edit: WorkspaceFileEdit,
    ) -> str:
        updated = source

        ordered = sorted(
            file_edit.edits,
            key=lambda edit: (
                edit.start,
                edit.end,
            ),
            reverse=True,
        )

        for edit in ordered:
            if edit.start > len(updated):
                raise RuntimeError(
                    "Workspace edit start exceeds "
                    f"file length in "
                    f"{file_edit.file_path}: "
                    f"{edit.start} > {len(updated)}"
                )

            if edit.end > len(updated):
                raise RuntimeError(
                    "Workspace edit end exceeds "
                    f"file length in "
                    f"{file_edit.file_path}: "
                    f"{edit.end} > {len(updated)}"
                )

            if edit.end < edit.start:
                raise RuntimeError(
                    "Workspace edit range is "
                    f"invalid in "
                    f"{file_edit.file_path}: "
                    f"{edit.start}:{edit.end}"
                )

            updated = (
                updated[:edit.start]
                + edit.text
                + updated[edit.end:]
            )

        return updated
