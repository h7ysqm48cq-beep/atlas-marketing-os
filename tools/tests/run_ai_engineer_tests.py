from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[2]

    tests = [
        root
        / "tools"
        / "tests"
        / "test_ai_engineer_core.py",
    ]

    missing = [
        path
        for path in tests
        if not path.exists()
    ]

    if missing:
        print("Missing test files:")

        for path in missing:
            print(f"- {path}")

        return 1

    command = [
        sys.executable,
        "-m",
        "pytest",
        "-q",
        *[
            str(path.relative_to(root))
            for path in tests
        ],
    ]

    return subprocess.run(
        command,
        cwd=root,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
