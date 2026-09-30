from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .natural_language import (
    build_natural_language_engineer,
)
from .request import AIEngineerMode


def emit(
    payload: dict[str, Any],
    *,
    exit_code: int = 0,
) -> None:
    sys.stdout.write(
        json.dumps(
            payload,
            ensure_ascii=False,
        )
    )
    sys.stdout.flush()

    raise SystemExit(exit_code)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="atlas-ai-engineer",
    )

    parser.add_argument(
        "--project",
        required=True,
    )

    parser.add_argument(
        "--text",
        required=True,
    )

    parser.add_argument(
        "--mode",
        choices=[
            mode.value
            for mode in AIEngineerMode
        ],
        default=AIEngineerMode.PLAN.value,
    )

    parser.add_argument(
        "--allow-apply",
        action="store_true",
    )

    return parser


def main() -> None:
    arguments = build_parser().parse_args()

    project = Path(
        arguments.project
    ).expanduser().resolve()

    try:
        result = (
            build_natural_language_engineer()
            .handle(
                arguments.text,
                target_project=str(project),
                mode=AIEngineerMode(
                    arguments.mode
                ),
                allow_apply=(
                    arguments.allow_apply
                ),
            )
        )

        emit(
            result.to_dict(),
            exit_code=(
                0 if result.success else 1
            ),
        )

    except Exception as error:
        emit(
            {
                "success": False,
                "error": (
                    f"{type(error).__name__}: "
                    f"{error}"
                ),
            },
            exit_code=1,
        )


if __name__ == "__main__":
    main()
