from __future__ import annotations

import argparse
import compileall
import json
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence


PATCH_NAME = "Patch010 Import Engine Validation"

REQUIRED_FILES = (
    "tools/modifier/import_insertion.py",
    "tools/modifier/default_import_insertion.py",
    "tools/modifier/import_removal.py",
    "tools/modifier/import_node.py",
    "tools/modifier/typescript.py",
    "tools/modifier/exceptions.py",
    "tools/tests/test_import_add.py",
    "tools/tests/test_import_insertion_branches.py",
    "tools/tests/test_default_import_insertion_branches.py",
    "tools/tests/test_import_removal_branches.py",
)

TEST_FILES = (
    "tools/tests/test_import_add.py",
    "tools/tests/test_import_insertion_branches.py",
    "tools/tests/test_default_import_insertion_branches.py",
    "tools/tests/test_import_removal_branches.py",
)


@dataclass(frozen=True, slots=True)
class CommandResult:
    command: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0


@dataclass(frozen=True, slots=True)
class ValidationReport:
    patch: str
    project_root: str
    required_files_ok: bool
    missing_files: tuple[str, ...]
    compile_ok: bool
    pytest_available: bool
    tests_ok: bool | None
    commands: tuple[CommandResult, ...]

    @property
    def ok(self) -> bool:
        return (
            self.required_files_ok
            and self.compile_ok
            and self.tests_ok is not False
        )


def run_command(
    command: Sequence[str],
    *,
    cwd: Path,
) -> CommandResult:
    process = subprocess.run(
        list(command),
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )

    return CommandResult(
        command=tuple(command),
        returncode=process.returncode,
        stdout=process.stdout,
        stderr=process.stderr,
    )


def resolve_project_root(value: str | Path) -> Path:
    root = Path(value).expanduser().resolve()

    if not root.exists():
        raise FileNotFoundError(
            f"Project root does not exist: {root}"
        )

    if not root.is_dir():
        raise NotADirectoryError(
            f"Project root is not a directory: {root}"
        )

    return root


def find_missing_files(root: Path) -> tuple[str, ...]:
    return tuple(
        relative
        for relative in REQUIRED_FILES
        if not (root / relative).is_file()
    )


def compile_import_engine(root: Path) -> bool:
    targets = (
        root / "tools" / "modifier",
        root / "tools" / "tests",
    )

    return all(
        compileall.compile_dir(
            str(target),
            quiet=1,
            force=True,
        )
        for target in targets
    )


def pytest_is_available() -> bool:
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--version"],
        text=True,
        capture_output=True,
        check=False,
    )

    return result.returncode == 0


def run_tests(root: Path) -> CommandResult:
    command = (
        sys.executable,
        "-m",
        "pytest",
        "-q",
        *TEST_FILES,
    )

    return run_command(command, cwd=root)


def print_command_result(result: CommandResult) -> None:
    rendered = " ".join(result.command)
    status = "PASS" if result.ok else "FAIL"

    print(f"\n[{status}] {rendered}")

    if result.stdout.strip():
        print(result.stdout.rstrip())

    if result.stderr.strip():
        print(result.stderr.rstrip(), file=sys.stderr)


def write_report(
    report: ValidationReport,
    destination: Path,
) -> None:
    payload = asdict(report)
    payload["ok"] = report.ok

    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    destination.write_text(
        json.dumps(
            payload,
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate the existing Atlas TypeScript import engine "
            "without changing source files."
        )
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Atlas repository root (default: current directory)",
    )
    parser.add_argument(
        "--report",
        default=".atlas/reports/patch010-import-engine.json",
        help="JSON report path relative to project root",
    )
    parser.add_argument(
        "--install-pytest",
        action="store_true",
        help=(
            "Install pytest into the current Python environment when "
            "it is unavailable."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = resolve_project_root(args.project_root)

    print(f"=== {PATCH_NAME} ===")
    print(f"Project root: {root}")

    missing = find_missing_files(root)
    required_files_ok = not missing

    if missing:
        print("\nMissing required files:")
        for relative in missing:
            print(f"  - {relative}")
    else:
        print("Required files: PASS")

    compile_ok = False
    commands: list[CommandResult] = []

    if required_files_ok:
        compile_ok = compile_import_engine(root)
        print(
            "Python compile: "
            + ("PASS" if compile_ok else "FAIL")
        )

    available = pytest_is_available()

    if not available and args.install_pytest:
        install_result = run_command(
            (
                sys.executable,
                "-m",
                "pip",
                "install",
                "pytest",
            ),
            cwd=root,
        )
        commands.append(install_result)
        print_command_result(install_result)
        available = install_result.ok and pytest_is_available()

    tests_ok: bool | None = None

    if required_files_ok and compile_ok and available:
        test_result = run_tests(root)
        commands.append(test_result)
        print_command_result(test_result)
        tests_ok = test_result.ok
    elif not available:
        print(
            "\nPytest is unavailable. Re-run with --install-pytest "
            "or install it manually."
        )

    report = ValidationReport(
        patch=PATCH_NAME,
        project_root=str(root),
        required_files_ok=required_files_ok,
        missing_files=missing,
        compile_ok=compile_ok,
        pytest_available=available,
        tests_ok=tests_ok,
        commands=tuple(commands),
    )

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = root / report_path

    write_report(report, report_path)
    print(f"\nReport: {report_path}")

    if report.ok and tests_ok is True:
        print("Patch010 Import Engine: VERIFIED")
        return 0

    if report.ok and tests_ok is None:
        print("Patch010 Import Engine: COMPILE VERIFIED, TESTS SKIPPED")
        return 2

    print("Patch010 Import Engine: FAILED")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
