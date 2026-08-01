from __future__ import annotations

from pathlib import Path
from typing import Any

from .ast_navigator import (
    ASTNavigator,
    ASTNodeNotFound,
    ClassNode,
    ConstructorNode,
    ParameterNode,
)
from .bridge import TypeScriptBridge
from .bridge_editor import (
    BridgeEditor,
    utf16_offset_to_python_index,
)
from .constructor_parameter import ConstructorParameter


class ConstructorModifierError(RuntimeError):
    """Base error raised by ConstructorModifier."""


class ConstructorNotFound(ConstructorModifierError):
    """Raised when the target class has no constructor."""


class UnsupportedConstructorShape(ConstructorModifierError):
    """Raised when the constructor shape is not supported yet."""


class ConstructorModifier:
    """
    Read and inspect a TypeScript class constructor.

    Patch 011A provides the stable read layer only. Source modification
    will be implemented in the next patch.

    Example:

        modifier = ConstructorModifier(
            "src/app.service.ts",
            class_name="AppService",
        )

        for parameter in modifier.parameters():
            print(parameter.name, parameter.type)
    """

    def __init__(
        self,
        path: str | Path,
        *,
        class_name: str | None = None,
        project_root: str | Path = ".",
        bridge: Any | None = None,
    ) -> None:
        self.path = Path(path)
        self.class_name = class_name
        self.project_root = Path(project_root)

        self.bridge = (
            bridge
            if bridge is not None
            else TypeScriptBridge(
                project_root=self.project_root
            )
        )

        self._source = ""
        self._original_source = ""
        self._bridge_result: Any | None = None

        self.load()

    def load(self) -> "ConstructorModifier":
        """
        Reload the TypeScript file from disk and parse its AST.

        Any unsaved in-memory state is discarded.
        """

        if not self.path.exists():
            raise FileNotFoundError(
                f"TypeScript file does not exist: {self.path}"
            )

        if not self.path.is_file():
            raise ConstructorModifierError(
                f"TypeScript path is not a file: {self.path}"
            )

        source = self.path.read_text(
            encoding="utf-8"
        )

        self._source = source
        self._original_source = source
        self._bridge_result = self.bridge.parse(
            self.path
        )

        return self

    def reset(self) -> "ConstructorModifier":
        """
        Discard in-memory state and reload the file from disk.
        """

        return self.load()

    def source(self) -> str:
        """Return the current in-memory TypeScript source."""

        return self._source

    def original_source(self) -> str:
        """Return the source loaded from disk."""

        return self._original_source

    def has_changes(self) -> bool:
        """Return whether the in-memory source differs from disk state."""

        return self._source != self._original_source

    def bridge_result(self) -> Any:
        """Return the latest TypeScriptBridge parse result."""

        if self._bridge_result is None:
            raise ConstructorModifierError(
                "TypeScript source has not been parsed"
            )

        return self._bridge_result

    def navigator(self) -> ASTNavigator:
        """Create a navigator for the latest parse result."""

        return ASTNavigator(
            self.bridge_result()
        )

    def class_node(self) -> ClassNode:
        """
        Return the target class.

        When class_name is None, ASTNavigator requires the file to
        contain exactly one class.
        """

        class_node = self.navigator().class_(
            self.class_name
        )

        if class_node is None:
            raise ConstructorModifierError(
                "Target TypeScript class could not be resolved"
            )

        return class_node

    def constructor_node(self) -> ConstructorNode:
        """Return the constructor belonging to the target class."""

        class_node = self.class_node()

        try:
            constructor = class_node.constructor()
        except ASTNodeNotFound as error:
            raise ConstructorNotFound(
                f"Class {class_node.name!r} does not contain "
                "a constructor"
            ) from error

        if constructor is None:
            raise ConstructorNotFound(
                f"Class {class_node.name!r} does not contain "
                "a constructor"
            )

        return constructor

    def parameters(self) -> tuple[ParameterNode, ...]:
        """Return all constructor parameters in source order."""

        return self.constructor_node().parameters()

    def find_parameter(
        self,
        name: str,
    ) -> ParameterNode | None:
        """Find a constructor parameter by name."""

        return self.constructor_node().parameter(
            name,
            required=False,
        )

    def has_parameter(
        self,
        name: str,
    ) -> bool:
        """Return whether the constructor contains a named parameter."""

        return self.find_parameter(name) is not None

    def save(self) -> bool:
        """
        Save the current in-memory source.

        Patch 011A does not yet expose a modification method, but save()
        is established now so later patches can reuse the same lifecycle.

        Returns False when nothing changed.
        """

        if not self.has_changes():
            return False

        self.path.write_text(
            self._source,
            encoding="utf-8",
        )

        self._original_source = self._source
        self._bridge_result = self.bridge.parse(
            self.path
        )

        return True

    def add_parameter(
        self,
        parameter: ConstructorParameter,
    ) -> bool:
        """
        Add a constructor parameter.

        Implemented in Patch 011B.
        """

        if not isinstance(
            parameter,
            ConstructorParameter,
        ):
            raise TypeError(
                "parameter must be a ConstructorParameter"
            )

        raise NotImplementedError(
            "ConstructorModifier.add_parameter() "
            "will be implemented in Patch 011B"
        )
