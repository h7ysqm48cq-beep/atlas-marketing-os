from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Mapping


class AIEngineerRequestError(ValueError):
    """Raised when an AI Engineer request is invalid."""


class AIEngineerMode(str, Enum):
    PLAN = "plan"
    PREVIEW = "preview"
    APPLY = "apply"


class AIEngineerOperation(str, Enum):
    CONNECT_SERVICE = "connect_service"
    CONNECT_CONTROLLER = "connect_controller"
    REGISTER_MODULE_IMPORT = "register_module_import"
    CREATE_CRUD = "create_crud"
    RENAME_SYMBOL = "rename_symbol"


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class AIEngineerRequest:
    operation: AIEngineerOperation
    arguments: dict[str, Any] = field(
        default_factory=dict,
    )
    mode: AIEngineerMode = AIEngineerMode.PLAN
    target_project: str = "."

    def __post_init__(self) -> None:
        project = self.target_project.strip()

        if not project:
            raise AIEngineerRequestError(
                "target_project cannot be empty"
            )

        object.__setattr__(
            self,
            "target_project",
            project,
        )

    @property
    def project_root(self) -> Path:
        return Path(
            self.target_project
        ).expanduser().resolve()

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any],
    ) -> "AIEngineerRequest":
        if not isinstance(value, Mapping):
            raise TypeError(
                "AI Engineer request must be a mapping"
            )

        raw_operation = value.get("operation")

        if not isinstance(raw_operation, str):
            raise AIEngineerRequestError(
                "operation must be a string"
            )

        try:
            operation = AIEngineerOperation(
                raw_operation.strip()
            )
        except ValueError as exc:
            supported = ", ".join(
                item.value
                for item in AIEngineerOperation
            )

            raise AIEngineerRequestError(
                "Unsupported operation "
                f"{raw_operation!r}. "
                f"Supported operations: {supported}"
            ) from exc

        raw_mode = value.get(
            "mode",
            AIEngineerMode.PLAN.value,
        )

        if not isinstance(raw_mode, str):
            raise AIEngineerRequestError(
                "mode must be a string"
            )

        try:
            mode = AIEngineerMode(
                raw_mode.strip()
            )
        except ValueError as exc:
            supported = ", ".join(
                item.value
                for item in AIEngineerMode
            )

            raise AIEngineerRequestError(
                f"Unsupported mode {raw_mode!r}. "
                f"Supported modes: {supported}"
            ) from exc

        raw_arguments = value.get(
            "arguments",
            {},
        )

        if not isinstance(
            raw_arguments,
            Mapping,
        ):
            raise AIEngineerRequestError(
                "arguments must be an object"
            )

        target_project = value.get(
            "target_project",
            ".",
        )

        if not isinstance(
            target_project,
            str,
        ):
            raise AIEngineerRequestError(
                "target_project must be a string"
            )

        request = cls(
            operation=operation,
            arguments=dict(raw_arguments),
            mode=mode,
            target_project=target_project,
        )

        request.validate_arguments()
        return request

    def validate_arguments(self) -> None:
        required = {
            AIEngineerOperation.CONNECT_SERVICE: (
                "target_class",
                "dependency_name",
                "dependency_type",
                "dependency_import",
            ),
            AIEngineerOperation.CONNECT_CONTROLLER: (
                "target_class",
                "dependency_name",
                "dependency_type",
                "dependency_import",
            ),
            AIEngineerOperation.REGISTER_MODULE_IMPORT: (
                "module_class",
                "module_import",
            ),
            AIEngineerOperation.CREATE_CRUD: (
                "resource_name",
            ),
            AIEngineerOperation.RENAME_SYMBOL: (
                "target_file",
                "old_name",
                "new_name",
            ),
        }

        missing: list[str] = []

        for key in required[self.operation]:
            value = self.arguments.get(key)

            if (
                not isinstance(value, str)
                or not value.strip()
            ):
                missing.append(key)

        if missing:
            raise AIEngineerRequestError(
                "Missing or invalid arguments: "
                + ", ".join(missing)
            )

        target_file = self.arguments.get(
            "target_file"
        )

        if isinstance(target_file, str):
            self._validate_target_file(
                target_file
            )

        elif (
            self.operation
            == AIEngineerOperation
            .REGISTER_MODULE_IMPORT
        ):
            target_class = self.arguments.get(
                "target_class"
            )

            if (
                not isinstance(
                    target_class,
                    str,
                )
                or not target_class.strip()
            ):
                raise AIEngineerRequestError(
                    "target_class is required when "
                    "target_file is omitted"
                )

    def _validate_target_file(
        self,
        value: str,
    ) -> None:
        path = Path(value.strip())

        if path.is_absolute():
            raise AIEngineerRequestError(
                "target_file must be relative "
                "to target_project"
            )

        if ".." in path.parts:
            raise AIEngineerRequestError(
                "target_file cannot escape "
                "target_project"
            )

        if path.suffix not in {
            ".ts",
            ".tsx",
        }:
            raise AIEngineerRequestError(
                "target_file must be a "
                "TypeScript file"
            )

    def argument(
        self,
        name: str,
    ) -> str:
        value = self.arguments.get(name)

        if not isinstance(value, str):
            raise AIEngineerRequestError(
                f"Argument {name!r} is missing"
            )

        normalized = value.strip()

        if not normalized:
            raise AIEngineerRequestError(
                f"Argument {name!r} cannot be empty"
            )

        return normalized

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation.value,
            "mode": self.mode.value,
            "target_project": self.target_project,
            "arguments": dict(self.arguments),
        }
