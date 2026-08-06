from __future__ import annotations

from pathlib import Path

from .action import (
    Action,
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
    AddProvider,
    CreateFile,
    RenameSymbol,
    WorkspaceEdit,
    WorkspaceFileEdit,
    WorkspaceTextEdit,
)
from .result import (
    ValidationDecision,
    ValidationResult,
    ValidationSeverity,
)


class CreateFileValidator:
    """
    Validate CreateFile actions before execution.

    Existing conflicting files are intentionally handled
    by CreateFileExecutor so transaction rollback remains
    under Runtime control.
    """

    def validate(
        self,
        action: Action,
        *,
        project_root: Path,
    ) -> ValidationResult:
        if not isinstance(
            action,
            CreateFile,
        ):
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "CreateFileValidator received "
                    f"{type(action).__name__}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        file_path = action.file_path

        if (
            not isinstance(file_path, str)
            or not file_path.strip()
        ):
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "CreateFile requires a non-empty "
                    "file_path."
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        content = action.content

        if (
            not isinstance(content, str)
            or not content
        ):
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "CreateFile requires non-empty "
                    "string content."
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        candidate = Path(
            file_path
        )

        if not candidate.is_absolute():
            candidate = (
                project_root / candidate
            )

        target = candidate.resolve()

        try:
            target.relative_to(
                project_root.resolve()
            )
        except ValueError:
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "CreateFile target escapes "
                    f"project root: {file_path}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        if target.exists() and not target.is_file():
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "CreateFile target exists but "
                    f"is not a file: {target}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        return ValidationResult(
            action_id=action.action_id,
            action_kind=action.kind,
            decision=ValidationDecision.PASS,
            message=(
                "CreateFile target is valid: "
                f"{file_path}"
            ),
            severity=ValidationSeverity.INFO,
            can_continue=True,
        )


class WorkspaceEditValidator:
    """
    Validate a multi-file workspace edit.

    The executor remains responsible for checking
    that source ranges still match file content.
    """

    def validate(
        self,
        action: Action,
        *,
        project_root: Path,
    ) -> ValidationResult:
        if not isinstance(
            action,
            WorkspaceEdit,
        ):
            return self._failure(
                action,
                "WorkspaceEditValidator received "
                f"{type(action).__name__}",
            )

        if not action.files:
            return self._failure(
                action,
                "WorkspaceEdit requires at least "
                "one file edit.",
            )

        seen_paths: set[str] = set()

        for file_edit in action.files:
            if not isinstance(
                file_edit,
                WorkspaceFileEdit,
            ):
                return self._failure(
                    action,
                    "WorkspaceEdit files must contain "
                    "WorkspaceFileEdit values.",
                )

            file_path = file_edit.file_path

            if (
                not isinstance(file_path, str)
                or not file_path.strip()
            ):
                return self._failure(
                    action,
                    "WorkspaceFileEdit requires a "
                    "non-empty file_path.",
                )

            candidate = Path(file_path)

            if not candidate.is_absolute():
                candidate = (
                    project_root / candidate
                )

            target = candidate.resolve()

            try:
                target.relative_to(
                    project_root.resolve()
                )
            except ValueError:
                return self._failure(
                    action,
                    "WorkspaceEdit target escapes "
                    f"project root: {file_path}",
                )

            normalized = target.as_posix()

            if normalized in seen_paths:
                return self._failure(
                    action,
                    "WorkspaceEdit contains duplicate "
                    f"file target: {file_path}",
                )

            seen_paths.add(normalized)

            if not target.exists():
                return self._failure(
                    action,
                    "WorkspaceEdit target does not "
                    f"exist: {target}",
                )

            if not target.is_file():
                return self._failure(
                    action,
                    "WorkspaceEdit target is not "
                    f"a file: {target}",
                )

            if target.suffix not in {
                ".ts",
                ".tsx",
            }:
                return self._failure(
                    action,
                    "WorkspaceEdit target must be "
                    f"TypeScript: {file_path}",
                )

            if not file_edit.edits:
                return self._failure(
                    action,
                    "WorkspaceFileEdit requires at "
                    f"least one edit: {file_path}",
                )

            previous_end = -1

            for edit in sorted(
                file_edit.edits,
                key=lambda item: (
                    item.start,
                    item.end,
                ),
            ):
                if not isinstance(
                    edit,
                    WorkspaceTextEdit,
                ):
                    return self._failure(
                        action,
                        "WorkspaceFileEdit edits must "
                        "contain WorkspaceTextEdit "
                        "values.",
                    )

                if (
                    isinstance(edit.start, bool)
                    or not isinstance(
                        edit.start,
                        int,
                    )
                    or edit.start < 0
                ):
                    return self._failure(
                        action,
                        "WorkspaceTextEdit start must "
                        "be a non-negative integer.",
                    )

                if (
                    isinstance(edit.end, bool)
                    or not isinstance(
                        edit.end,
                        int,
                    )
                    or edit.end < edit.start
                ):
                    return self._failure(
                        action,
                        "WorkspaceTextEdit end must be "
                        "greater than or equal to start.",
                    )

                if not isinstance(
                    edit.text,
                    str,
                ):
                    return self._failure(
                        action,
                        "WorkspaceTextEdit text must "
                        "be a string.",
                    )

                if edit.start < previous_end:
                    return self._failure(
                        action,
                        "WorkspaceTextEdit ranges "
                        f"overlap in {file_path}.",
                    )

                previous_end = edit.end

        return ValidationResult(
            action_id=action.action_id,
            action_kind=action.kind,
            decision=ValidationDecision.PASS,
            message=(
                "WorkspaceEdit is valid for "
                f"{len(action.files)} files."
            ),
            severity=ValidationSeverity.INFO,
            can_continue=True,
        )

    @staticmethod
    def _failure(
        action: Action,
        message: str,
    ) -> ValidationResult:
        return ValidationResult(
            action_id=action.action_id,
            action_kind=action.kind,
            decision=ValidationDecision.FAIL,
            message=message,
            severity=ValidationSeverity.ERROR,
            can_continue=False,
        )


class RenameSymbolValidator:
    def validate(
        self,
        action: Action,
        *,
        project_root: Path,
    ) -> ValidationResult:
        if not isinstance(
            action,
            RenameSymbol,
        ):
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "RenameSymbolValidator received "
                    f"{type(action).__name__}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        for field_name in (
            "file_path",
            "old_name",
            "new_name",
        ):
            value = getattr(
                action,
                field_name,
                None,
            )

            if (
                not isinstance(value, str)
                or not value.strip()
            ):
                return ValidationResult(
                    action_id=action.action_id,
                    action_kind=action.kind,
                    decision=ValidationDecision.FAIL,
                    message=(
                        "RenameSymbol requires "
                        f"a non-empty {field_name}."
                    ),
                    severity=(
                        ValidationSeverity.ERROR
                    ),
                    can_continue=False,
                )

        target = Path(action.file_path)

        if not target.is_absolute():
            target = project_root / target

        target = target.resolve()

        try:
            target.relative_to(
                project_root.resolve()
            )
        except ValueError:
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "RenameSymbol target escapes "
                    f"project root: "
                    f"{action.file_path}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        if not target.exists():
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "RenameSymbol target does not "
                    f"exist: {target}"
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
                    "RenameSymbol target is not "
                    f"a file: {target}"
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        if target.suffix not in {
            ".ts",
            ".tsx",
        }:
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.FAIL,
                message=(
                    "RenameSymbol target must be "
                    "a TypeScript file."
                ),
                severity=ValidationSeverity.ERROR,
                can_continue=False,
            )

        if (
            action.old_name.strip()
            == action.new_name.strip()
        ):
            return ValidationResult(
                action_id=action.action_id,
                action_kind=action.kind,
                decision=ValidationDecision.SKIP,
                message=(
                    "Old and new symbol names "
                    "are identical."
                ),
                severity=ValidationSeverity.INFO,
                can_continue=True,
            )

        return ValidationResult(
            action_id=action.action_id,
            action_kind=action.kind,
            decision=ValidationDecision.PASS,
            message=(
                "RenameSymbol request is valid: "
                f"{action.old_name} -> "
                f"{action.new_name}"
            ),
            severity=ValidationSeverity.INFO,
            can_continue=True,
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
    file_target_validator = (
        FileTargetValidator()
    )

    for action_type in (
        AddImport,
        AddConstructorParameter,
        AddModuleImport,
        AddProvider,
    ):
        registry.register(
            action_type,
            file_target_validator,
        )

    registry.register(
        CreateFile,
        CreateFileValidator(),
    )
    registry.register(
        RenameSymbol,
        RenameSymbolValidator(),
    )
    registry.register(
        WorkspaceEdit,
        WorkspaceEditValidator(),
    )
