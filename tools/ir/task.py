from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
from uuid import uuid4


@dataclass(slots=True, kw_only=True)
class Task:
    """
    High-level Atlas intent.

    A Task describes the outcome the Planner wants.
    It must not contain execution or AST-editing logic.
    """

    task_id: str = field(
        default_factory=lambda: uuid4().hex,
    )
    metadata: dict[str, Any] = field(
        default_factory=dict,
    )

    @property
    def kind(self) -> str:
        return type(self).__name__

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["kind"] = self.kind
        return data


@dataclass(slots=True, kw_only=True)
class ConnectServiceTask(Task):
    """
    Connect one injectable service to another service.

    Example:
    Inject AtlasBrainService into CopilotService.
    """

    target_file: str
    target_class: str

    dependency_name: str
    dependency_type: str
    dependency_import: str

    modifiers: tuple[str, ...] = (
        "private",
        "readonly",
    )


@dataclass(slots=True, kw_only=True)
class RegisterModuleImportTask(Task):
    """
    Register a NestJS module inside another module's imports array.
    """

    target_file: str
    module_class: str
    module_import: str
