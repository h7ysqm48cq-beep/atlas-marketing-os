from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

from patch_lib import PatchContext, PatchError


ROOT = Path(__file__).resolve().parents[1]
PATCH_DIR = ROOT / "tools" / "patches"
BACKUP_DIR = ROOT / "tools" / "backups"


def normalize_patch_id(value: str) -> str:
    return value.strip().upper().replace("PATCH_", "")


def locate_patch(patch_id: str) -> Path:
    candidates = [
        PATCH_DIR / f"patch_{patch_id}.py",
        PATCH_DIR / f"patch_{patch_id.lower()}.py",
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    available = sorted(
        path.stem.replace("patch_", "")
        for path in PATCH_DIR.glob("patch_*.py")
    )

    raise PatchError(
        f"Patch {patch_id} not found. "
        f"Available: {', '.join(available) or 'none'}"
    )


def load_patch(path: Path):
    spec = importlib.util.spec_from_file_location(
        path.stem,
        path,
    )

    if spec is None or spec.loader is None:
        raise PatchError(f"Cannot load patch: {path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_patch(
    patch_id: str,
    dry_run: bool,
    skip_build: bool,
) -> None:
    path = locate_patch(patch_id)
    module = load_patch(path)

    manifest = getattr(module, "MANIFEST", None)
    apply_patch = getattr(module, "apply", None)

    if not isinstance(manifest, dict):
        raise PatchError(
            f"{path.name} does not define MANIFEST"
        )

    if not callable(apply_patch):
        raise PatchError(
            f"{path.name} does not define apply(context)"
        )

    context = PatchContext(
        root=ROOT,
        patch_id=manifest["id"],
        dry_run=dry_run,
    )

    print("=" * 64)
    print(
        f"Patch {manifest['id']}: "
        f"{manifest.get('name', 'Unnamed patch')}"
    )
    print(f"Version: {manifest.get('version', 'unknown')}")
    print(f"Dry run: {dry_run}")
    print("=" * 64)

    apply_patch(context)

    if not skip_build:
        for command in manifest.get("build", []):
            context.run(command)

    context.save_metadata(manifest)

    print("\nGit status:")
    context.run(
        ["git", "status", "--short"],
        check=False,
    )

    print("\nDiff summary:")
    context.run(
        ["git", "diff", "--stat"],
        check=False,
    )

    if dry_run:
        print("\nDry run completed. No files were changed.")
    else:
        print(
            f"\nPatch {manifest['id']} completed successfully."
        )
        print(f"Backup: {context.backup_root}")


def list_patches() -> None:
    rows = []

    for path in sorted(PATCH_DIR.glob("patch_*.py")):
        module = load_patch(path)
        manifest = getattr(module, "MANIFEST", {})
        rows.append(
            (
                manifest.get(
                    "id",
                    path.stem.replace("patch_", ""),
                ),
                manifest.get("name", "Unnamed patch"),
                manifest.get("version", "unknown"),
            )
        )

    if not rows:
        print("No patches available.")
        return

    for patch_id, name, version in rows:
        print(f"{patch_id:<8} {version:<10} {name}")


def rollback(patch_id: str) -> None:
    normalized = normalize_patch_id(patch_id)

    matches = sorted(
        BACKUP_DIR.glob(f"{normalized}-*"),
        reverse=True,
    )

    if not matches:
        raise PatchError(
            f"No backup found for patch {normalized}"
        )

    backup = matches[0]
    metadata_path = backup / "metadata.json"

    if not metadata_path.exists():
        raise PatchError(
            f"Missing metadata: {metadata_path}"
        )

    metadata = json.loads(
        metadata_path.read_text(encoding="utf-8")
    )

    restored = 0

    for source in backup.rglob("*"):
        if (
            not source.is_file()
            or source.name == "metadata.json"
        ):
            continue

        relative = source.relative_to(backup)
        destination = ROOT / relative
        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )
        destination.write_bytes(source.read_bytes())
        print(f"Restored: {relative}")
        restored += 1

    changed_files = metadata.get("changedFiles", [])

    for relative in changed_files:
        backup_copy = backup / relative
        destination = ROOT / relative

        if not backup_copy.exists() and destination.exists():
            destination.unlink()
            print(f"Removed newly created file: {relative}")

    print(
        f"Rollback completed from {backup.name}. "
        f"Restored {restored} file(s)."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Atlas Marketing OS patch runner"
    )

    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser(
        "run",
        help="Run a patch",
    )
    run_parser.add_argument("patch_id")
    run_parser.add_argument(
        "--dry-run",
        action="store_true",
    )
    run_parser.add_argument(
        "--skip-build",
        action="store_true",
    )

    subparsers.add_parser(
        "list",
        help="List available patches",
    )

    rollback_parser = subparsers.add_parser(
        "rollback",
        help="Rollback the latest backup for a patch",
    )
    rollback_parser.add_argument("patch_id")

    args = parser.parse_args()

    try:
        if args.command == "run":
            run_patch(
                normalize_patch_id(args.patch_id),
                args.dry_run,
                args.skip_build,
            )
        elif args.command == "list":
            list_patches()
        elif args.command == "rollback":
            rollback(args.patch_id)
        else:
            parser.print_help()
            return 1

        return 0

    except PatchError as error:
        print(f"\nPatch failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
