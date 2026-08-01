from __future__ import annotations

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
    UnsupportedConstructorShape,
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
