#!/usr/bin/env python3
"""
Patch 008A: Fix Patch 008 project-root import verification.

Problem:
    Running a patch by file path places tools/patches on sys.path,
    but does not guarantee that the project root is available.

Fix:
    Insert PROJECT_ROOT into sys.path before importing tools.modifier.

Usage:
    python3 tools/patches/patch_008A_fix_import_path.py --check
    python3 tools/patches/patch_008A_fix_import_path.py --apply
"""

from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


PATCH_ID = "008A"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TARGET = (
    PROJECT_ROOT
    / "tools"
    / "patches"
    / "patch_008_constructor_modifier.py"
)

BACKUP_ROOT = (
    PROJECT_ROOT
    / ".atlas"
    / "backups"
    / "patch_008A"
)

OLD_BLOCK = '''\
    import importlib

    importlib.invalidate_caches()
'''

NEW_BLOCK = '''\
    import importlib

    project_root = str(PROJECT_ROOT.resolve())

    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    importlib.invalidate_caches()
'''


def relative(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def read_target() -> str:
    if not TARGET.exists():
        raise FileNotFoundError(
            f"Patch 008 file not found: {relative(TARGET)}"
        )

    return TARGET.read_text(encoding="utf-8")


def status(source: str) -> str:
    if NEW_BLOCK in source:
        return "already_applied"

    if OLD_BLOCK in source:
        return "required"

    return "unknown"


def create_backup() -> Path:
    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S_%f"
    )

    backup = (
        BACKUP_ROOT
        / timestamp
        / TARGET.relative_to(PROJECT_ROOT)
    )

    backup.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    shutil.copy2(TARGET, backup)
    return backup


def apply_patch(source: str) -> None:
    updated = source.replace(
        OLD_BLOCK,
        NEW_BLOCK,
        1,
    )

    if updated == source:
        raise RuntimeError(
            "Patch 008 import verification block was not changed"
        )

    compile(
        updated,
        str(TARGET),
        "exec",
    )

    TARGET.write_text(
        updated,
        encoding="utf-8",
    )


def verify() -> None:
    source = read_target()

    if NEW_BLOCK not in source:
        raise RuntimeError(
            "PROJECT_ROOT sys.path fix is missing"
        )

    compile(
        source,
        str(TARGET),
        "exec",
    )

    print("  ✓ Project-root insertion present")
    print("  ✓ Patch 008 Python syntax valid")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Atlas Patch 008A"
    )

    mode = parser.add_mutually_exclusive_group(
        required=True
    )

    mode.add_argument(
        "--check",
        action="store_true",
    )

    mode.add_argument(
        "--apply",
        action="store_true",
    )

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    print()
    print("=" * 72)
    print("ATLAS PATCH 008A: Fix Project-Root Import Path")
    print("=" * 72)
    print()

    try:
        source = read_target()
        current_status = status(source)

        if current_status == "already_applied":
            print(
                "✓ [UNCHANGED] "
                f"{relative(TARGET)}"
            )
            print(
                "  Project-root import fix is already present."
            )

            if args.apply:
                verify()

            print()
            print("PATCH 008A ALREADY APPLIED")
            return 0

        if current_status == "unknown":
            raise RuntimeError(
                "Could not safely locate the expected "
                "verify_imports() block in Patch 008"
            )

        print(
            "• [UPDATE] "
            f"{relative(TARGET)}"
        )
        print(
            "  Add PROJECT_ROOT to sys.path before "
            "importing tools.modifier."
        )

        if args.check:
            print()
            print("CHECK RESULT: PATCH REQUIRED")
            return 0

        backup = create_backup()

        print()
        print(
            "Backup:"
        )
        print(
            f"  ✓ {relative(backup)}"
        )

        apply_patch(source)

        print()
        print(
            f"  ✓ Updated {relative(TARGET)}"
        )

        verify()

        print()
        print("=" * 72)
        print("PATCH 008A COMPLETED SUCCESSFULLY")
        print("=" * 72)
        print()

        return 0

    except Exception as error:
        print()
        print("=" * 72)
        print("PATCH 008A FAILED")
        print("=" * 72)
        print(
            f"{type(error).__name__}: {error}"
        )
        print()

        return 1


if __name__ == "__main__":
    raise SystemExit(main())
