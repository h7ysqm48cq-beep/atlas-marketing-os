from __future__ import annotations

from pathlib import Path

from .action import (
    Action,
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
    AddProvider,
)
from .result import (
    ValidationDecision,
    ValidationResult,
    ValidationSeverity,
)


class FileTargetValidator:
    """
    Initial generic validator.

    It only confirms that the target file exists.
    AST-aware duplicate and symbol validation will be added later.
    """

    def validate(
        self,
        action: Action,
        *,
        project_root: Path,
    ) -> ValidationResult:
        file_path = getattr(
            action,
            "file_path",
            None,
        )

        if not file_path:
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    f"{action.kind} does not define "
                    f"a target file."
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        target = project_root / file_path

        if not target.exists():
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    f"Target file does not exist: "
                    f"{target}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        if not target.is_file():
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    f"Target is not a file: "
                    f"{target}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        return ValidationResult(
            action_id=action.action_id,
            action_kind=action.kind,
            decision=ValidationDecision.PASS,
            message=(
                f"Target file is available: "
                f"{file_path}"
            ),
            severity=ValidationSeverity.INFO,
            can_continue=True,
        )


def register_basic_validators(
    registry,
) -> None:
    validator = FileTargetValidator()

    for action_type in (
        AddImport,
        AddConstructorParameter,
        AddModuleImport,
        AddProvider,
    ):
        registry.register(
            action_type,
            validator,
        )
