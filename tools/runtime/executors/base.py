from __future__ import annotations

import difflib
from pathlib import Path


class BaseTypeScriptExecutor:
    """
    Base class for all TypeScript executors.
    """

    def __init__(
        self,
        *,
        project_root=".",
        dry_run=False,
        show_preview=True,
    ):
        self.project_root = Path(project_root).resolve()
        self.dry_run = dry_run
        self.show_preview = show_preview

    def resolve_target(self, file_path):
        candidate = Path(file_path)

        if not candidate.is_absolute():
            candidate = self.project_root / candidate

        resolved = candidate.resolve()

        resolved.relative_to(self.project_root)

        return resolved

    def build_preview(
        self,
        target,
        before,
        after,
    ):
        if before == after:
            return ""

        relative = target.relative_to(
            self.project_root
        )

        return "".join(
            difflib.unified_diff(
                before.splitlines(
                    keepends=True,
                ),
                after.splitlines(
                    keepends=True,
                ),
                fromfile=f"a/{relative}",
                tofile=f"b/{relative}",
            )
        )

    def print_preview(
        self,
        preview,
    ):
        if (
            self.show_preview
            and preview
        ):
            print()
            print(
                "----- PATCH PREVIEW -----"
            )
            print(
                preview.rstrip()
            )
            print(
                "----- END PREVIEW -----"
            )
            print()
