from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import (
    Action,
    AddConstructorParameter,
)
from tools.modifier.bridge import (
    TypeScriptBridge,
)
from tools.modifier.constructor_parameter import (
    ConstructorParameter,
)
from tools.modifier.typescript_constructor import (
    ConstructorModifier,
)

from .base import BaseTypeScriptExecutor


@dataclass(slots=True, frozen=True)
class ConstructorParameterExecutionResult:
    file_path: str
    changed: bool
    saved: bool
    preview: str


class AddConstructorParameterExecutor(
    BaseTypeScriptExecutor,
):
    """Execute AddConstructorParameter through ConstructorModifier."""

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
            ConstructorParameterExecutionResult | None
        ) = None

    @staticmethod
    def _build_parameter(
        action: AddConstructorParameter,
    ) -> ConstructorParameter:
        """Build ConstructorParameter across compatible field names."""

        signature = inspect.signature(
            ConstructorParameter
        )
        names = set(signature.parameters)
        values = {
            "name": action.parameter_name,
            "type": action.parameter_type,
            "type_annotation": action.parameter_type,
            "parameter_type": action.parameter_type,
            "modifiers": action.modifiers,
        }

        kwargs = {
            name: values[name]
            for name in names
            if name in values
        }

        if "name" not in kwargs:
            raise RuntimeError(
                "ConstructorParameter does not expose a name field"
            )

        if not any(
            key in kwargs
            for key in (
                "type",
                "type_annotation",
                "parameter_type",
            )
        ):
            raise RuntimeError(
                "ConstructorParameter does not expose a type field"
            )

        return ConstructorParameter(**kwargs)

    def execute(
        self,
        action: Action,
    ) -> None:
        if not isinstance(
            action,
            AddConstructorParameter,
        ):
            raise TypeError(
                "AddConstructorParameterExecutor expected "
                "AddConstructorParameter, received "
                f"{type(action).__name__}"
            )

        target = self.resolve_target(
            action.file_path
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

        parser_path = (
            Path(__file__).resolve().parents[2]
            / "modifier"
            / "parser.js"
        )

        bridge = TypeScriptBridge(
            project_root=self.project_root,
            parser_path=parser_path,
        )

        modifier = ConstructorModifier(
            target,
            class_name=action.class_name,
            project_root=self.project_root,
            bridge=bridge,
        )

        changed = modifier.add_parameter(
            self._build_parameter(action)
        )

        updated_text = modifier.source()
        preview = self.build_preview(
            target,
            original_text,
            updated_text,
        )

        saved = False

        if changed and not self.dry_run:
            saved = modifier.save()

        self.last_result = (
            ConstructorParameterExecutionResult(
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
            "ADD CONSTRUCTOR PARAMETER -> "
            f"{action.parameter_name}: "
            f"{action.parameter_type}"
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
