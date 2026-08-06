from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4


class ActionStatus(str, Enum):
    PENDING = "pending"
    VALIDATED = "validated"
    EXECUTING = "executing"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass(slots=True, kw_only=True)
class Action:
    """
    Base class for every Atlas IR action.

    An Action describes WHAT should happen.
    It must not contain AST or file-editing implementation details.
    """

    action_id: str = field(
        default_factory=lambda: uuid4().hex,
    )
    status: ActionStatus = ActionStatus.PENDING

    @property
    def kind(self) -> str:
        return type(self).__name__

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["kind"] = self.kind
        data["status"] = self.status.value
        return data


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class WorkspaceTextEdit:
    start: int
    end: int
    text: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
        }


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class WorkspaceFileEdit:
    file_path: str
    edits: tuple[
        WorkspaceTextEdit,
        ...,
    ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_path": self.file_path,
            "edits": [
                edit.to_dict()
                for edit in self.edits
            ],
        }


@dataclass(slots=True, kw_only=True)
class WorkspaceEdit(Action):
    files: tuple[
        WorkspaceFileEdit,
        ...,
    ]

    def to_dict(self) -> dict[str, Any]:
        data = super().to_dict()
        data["files"] = [
            file.to_dict()
            for file in self.files
        ]
        return data


@dataclass(slots=True, kw_only=True)
class CreateFile(Action):
    file_path: str
    content: str
    overwrite: bool = False


@dataclass(slots=True, kw_only=True)
class RenameSymbol(Action):
    file_path: str
    old_name: str
    new_name: str


@dataclass(slots=True, kw_only=True)
class AddImport(Action):
    file_path: str
    symbol: str
    module: str
    default: bool = False


@dataclass(slots=True, kw_only=True)
class AddConstructorParameter(Action):
    file_path: str
    class_name: str
    parameter_name: str
    parameter_type: str
    modifiers: tuple[str, ...] = (
        "private",
        "readonly",
    )
    import_module: str | None = None


@dataclass(slots=True, kw_only=True)
class AddModuleImport(Action):
    file_path: str
    module_class: str
    import_module: str | None = None


@dataclass(slots=True, kw_only=True)
class AddProvider(Action):
    file_path: str
    provider_class: str
    import_module: str | None = None
