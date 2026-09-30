from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "011A",
    "name": "Constructor Modifier Read Layer",
    "version": "1.0.0",
    "requires": ["010B"],
    "description": (
        "Builds the read-only foundation of ConstructorModifier using "
        "TypeScriptBridge and ASTNavigator."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_constructor_modifier_read",
        ],
    ],
}


CONSTRUCTOR_MODIFIER_SOURCE = r'''from __future__ import annotations

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
from .constructor_parameter import ConstructorParameter


class ConstructorModifierError(RuntimeError):
    """Base error raised by ConstructorModifier."""


class ConstructorNotFound(ConstructorModifierError):
    """Raised when the target class has no constructor."""


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
'''.strip() + "\n"


TEST_SOURCE = r'''from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.modifier.constructor_parameter import (
    ConstructorParameter,
)
from tools.modifier.typescript_constructor import (
    ConstructorModifier,
    ConstructorModifierError,
    ConstructorNotFound,
)


class FakeBridge:
    def __init__(self) -> None:
        self.parse_calls: list[Path] = []

    def parse(self, path: Path) -> dict:
        path = Path(path)
        self.parse_calls.append(path)

        source = path.read_text(
            encoding="utf-8"
        )

        constructors = []

        if "constructor" in source:
            parameters = []

            if "config" in source:
                parameters.append(
                    {
                        "name": "config",
                        "type": "ConfigService",
                        "start": 45,
                        "end": 83,
                        "modifiers": [
                            "private",
                            "readonly",
                        ],
                        "decorators": [],
                    }
                )

            if "logger" in source:
                parameters.append(
                    {
                        "name": "logger",
                        "type": "Logger",
                        "start": 89,
                        "end": 120,
                        "modifiers": [
                            "private",
                            "readonly",
                        ],
                        "decorators": [],
                    }
                )

            constructors.append(
                {
                    "start": 28,
                    "end": 140,
                    "bodyStart": 132,
                    "bodyEnd": 139,
                    "parameters": parameters,
                }
            )

        return {
            "file": {
                "lineCount": source.count("\n") + 1,
            },
            "classes": [
                {
                    "name": "AppService",
                    "start": 0,
                    "end": len(source),
                    "constructors": constructors,
                }
            ],
        }


class ConstructorModifierReadTests(
    unittest.TestCase
):
    def setUp(self) -> None:
        self.temporary_directory = (
            tempfile.TemporaryDirectory()
        )

        self.root = Path(
            self.temporary_directory.name
        )

        self.path = (
            self.root / "app.service.ts"
        )

        self.bridge = FakeBridge()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_source(
        self,
        source: str,
    ) -> None:
        self.path.write_text(
            source,
            encoding="utf-8",
        )

    def create_modifier(
        self,
    ) -> ConstructorModifier:
        return ConstructorModifier(
            self.path,
            class_name="AppService",
            project_root=self.root,
            bridge=self.bridge,
        )

    def test_loads_source_from_disk(self) -> None:
        source = """export class AppService {
  constructor() {}
}
"""

        self.write_source(source)

        modifier = self.create_modifier()

        self.assertEqual(
            modifier.source(),
            source,
        )

        self.assertEqual(
            modifier.original_source(),
            source,
        )

    def test_bridge_is_called_during_load(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        self.create_modifier()

        self.assertEqual(
            self.bridge.parse_calls,
            [self.path],
        )

    def test_class_node(self) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertEqual(
            modifier.class_node().name,
            "AppService",
        )

    def test_constructor_node(self) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()
        constructor = modifier.constructor_node()

        self.assertEqual(
            constructor.start,
            28,
        )

        self.assertEqual(
            constructor.body_start,
            132,
        )

    def test_parameters_returns_ast_nodes(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertEqual(
            [
                parameter.name
                for parameter in modifier.parameters()
            ],
            [
                "config",
                "logger",
            ],
        )

    def test_find_parameter(self) -> None:
        self.write_source(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""
        )

        modifier = self.create_modifier()

        parameter = modifier.find_parameter(
            "config"
        )

        self.assertIsNotNone(parameter)

        self.assertEqual(
            parameter.name,
            "config",
        )

        self.assertEqual(
            parameter.type,
            "ConfigService",
        )

    def test_find_missing_parameter_returns_none(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertIsNone(
            modifier.find_parameter("logger")
        )

    def test_has_parameter(self) -> None:
        self.write_source(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertTrue(
            modifier.has_parameter("config")
        )

        self.assertFalse(
            modifier.has_parameter("logger")
        )

    def test_missing_constructor_raises(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
}
"""
        )

        modifier = self.create_modifier()

        with self.assertRaises(
            ConstructorNotFound
        ):
            modifier.constructor_node()

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(
            FileNotFoundError
        ):
            self.create_modifier()

    def test_directory_path_is_rejected(
        self,
    ) -> None:
        with self.assertRaises(
            ConstructorModifierError
        ):
            ConstructorModifier(
                self.root,
                class_name="AppService",
                project_root=self.root,
                bridge=self.bridge,
            )

    def test_has_changes_is_initially_false(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertFalse(
            modifier.has_changes()
        )

    def test_save_without_changes_returns_false(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        self.assertFalse(
            modifier.save()
        )

    def test_reset_reloads_file(self) -> None:
        first_source = """export class AppService {
  constructor() {}
}
"""

        second_source = """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""

        self.write_source(first_source)

        modifier = self.create_modifier()

        self.write_source(second_source)

        result = modifier.reset()

        self.assertIs(
            result,
            modifier,
        )

        self.assertEqual(
            modifier.source(),
            second_source,
        )

        self.assertTrue(
            modifier.has_parameter("config")
        )

    def test_add_parameter_is_reserved_for_011b(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        with self.assertRaises(
            NotImplementedError
        ):
            modifier.add_parameter(
                ConstructorParameter(
                    name="logger",
                    type="Logger",
                )
            )

    def test_add_parameter_rejects_wrong_type(
        self,
    ) -> None:
        self.write_source(
            """export class AppService {
  constructor() {}
}
"""
        )

        modifier = self.create_modifier()

        with self.assertRaises(TypeError):
            modifier.add_parameter(
                "private readonly logger: Logger"
            )


if __name__ == "__main__":
    unittest.main()
'''.strip() + "\n"


EXPORT_BLOCK = r'''from .typescript_constructor import (
    ConstructorModifier,
    ConstructorModifierError,
    ConstructorNotFound,
)'''


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/modifier/typescript_constructor.py",
        CONSTRUCTOR_MODIFIER_SOURCE,
    )

    context.write_text(
        "tools/tests/test_constructor_modifier_read.py",
        TEST_SOURCE,
    )

    context.append_once(
        "tools/modifier/__init__.py",
        EXPORT_BLOCK,
    )
