from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .bridge import (
    TypeScriptBridge,
)
from .bridge_editor import (
    BridgeEditor,
)


def _value(
    obj: object,
    name: str,
) -> Any:
    value = getattr(
        obj,
        name,
    )

    if callable(value):
        return value()

    return value


def _error_payload(
    error: Exception,
) -> dict[str, Any]:
    return {
        "ok": False,
        "error": str(error),
        "errorType": type(error).__name__,
    }


def run(
    *,
    project_root: str,
    file_path: str,
    operations: list[dict[str, Any]],
) -> dict[str, Any]:

    root = Path(
        project_root,
    ).resolve()

    bridge = TypeScriptBridge(
        project_root=root,
    )

    resolved = bridge.resolve(
        file_path,
    )

    source = resolved.read_text(
        encoding="utf-8",
    )

    bridge_result = bridge.parse(
        file_path,
    )

    editor = BridgeEditor(
        source,
        bridge_result,
    )

    for index, operation in enumerate(
        operations,
    ):

        if not isinstance(
            operation,
            dict,
        ):
            raise TypeError(
                f"Operation {index} must be an object."
            )

        kind = operation.get(
            "type",
        )

        if kind == "insert":

            position = operation.get(
                "position",
            )

            text = operation.get(
                "text",
            )

            if not isinstance(
                position,
                int,
            ):
                raise TypeError(
                    f"Insert operation {index} requires integer position."
                )

            if not isinstance(
                text,
                str,
            ):
                raise TypeError(
                    f"Insert operation {index} requires text."
                )

            editor.insert(
                position,
                text,
            )

        elif kind == "replace":

            start = operation.get(
                "start",
            )

            end = operation.get(
                "end",
            )

            text = operation.get(
                "text",
            )

            if not isinstance(
                start,
                int,
            ):
                raise TypeError(
                    f"Replace operation {index} requires integer start."
                )

            if not isinstance(
                end,
                int,
            ):
                raise TypeError(
                    f"Replace operation {index} requires integer end."
                )

            if not isinstance(
                text,
                str,
            ):
                raise TypeError(
                    f"Replace operation {index} requires text."
                )

            editor.replace(
                start,
                end,
                text,
            )

        elif kind == "delete":

            start = operation.get(
                "start",
            )

            end = operation.get(
                "end",
            )

            if not isinstance(
                start,
                int,
            ):
                raise TypeError(
                    f"Delete operation {index} requires integer start."
                )

            if not isinstance(
                end,
                int,
            ):
                raise TypeError(
                    f"Delete operation {index} requires integer end."
                )

            editor.delete(
                start,
                end,
            )

        else:

            raise ValueError(
                f"Unsupported operation type at index {index}: {kind!r}"
            )

    pending_before_apply = _value(
        editor,
        "pending_count",
    )

    changed = editor.apply()

    updated_source = _value(
        editor,
        "source",
    )

    return {
        "ok": True,
        "filePath": file_path,
        "resolvedPath": str(
            resolved,
        ),
        "schemaVersion": (
            bridge_result.raw.get(
                "schemaVersion",
            )
        ),
        "operationCount": len(
            operations,
        ),
        "pendingBeforeApply": (
            pending_before_apply
        ),
        "changed": bool(
            changed,
        ),
        "source": updated_source,
        "originalSize": len(
            source,
        ),
        "updatedSize": len(
            updated_source,
        ),
    }


def main() -> None:

    parser = argparse.ArgumentParser(
        description=(
            "Atlas AST BridgeEditor preview executor"
        ),
    )

    parser.add_argument(
        "--project",
        default=".",
    )

    parser.add_argument(
        "--file",
        required=True,
    )

    parser.add_argument(
        "--operations",
        required=True,
        help="JSON array of structured edit operations.",
    )

    args = parser.parse_args()

    try:

        operations = json.loads(
            args.operations,
        )

        if not isinstance(
            operations,
            list,
        ):
            raise TypeError(
                "operations must be a JSON array."
            )

        result = run(
            project_root=args.project,
            file_path=args.file,
            operations=operations,
        )

    except Exception as error:

        result = _error_payload(
            error,
        )

    print(
        json.dumps(
            result,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
