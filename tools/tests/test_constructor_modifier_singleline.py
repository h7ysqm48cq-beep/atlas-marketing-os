from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.modifier import (
    ConstructorModifier,
    ConstructorParameter,
)
from tools.tests.test_constructor_modifier_insert import (
    FakeBridge,
)


class ConstructorModifierSingleLineTests(
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

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_modifier(
        self,
        source: str,
    ) -> ConstructorModifier:
        self.path.write_text(
            source,
            encoding="utf-8",
        )

        return ConstructorModifier(
            self.path,
            class_name="AppService",
            project_root=self.root,
            bridge=FakeBridge(),
        )

    def test_single_line_becomes_multiline(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(private readonly config: ConfigService) {}
}
"""
        )

        changed = modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="Logger",
            )
        )

        self.assertTrue(changed)

        self.assertEqual(
            modifier.source(),
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}
}
""",
        )

    def test_added_parameter_is_reparsed(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(private readonly config: ConfigService) {}
}
"""
        )

        modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="Logger",
            )
        )

        self.assertTrue(
            modifier.has_parameter("config")
        )

        self.assertTrue(
            modifier.has_parameter("logger")
        )

        self.assertEqual(
            [
                parameter.name
                for parameter
                in modifier.parameters()
            ],
            ["config", "logger"],
        )

    def test_duplicate_is_rejected(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(private readonly logger: Logger) {}
}
"""
        )

        changed = modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="AnotherLogger",
            )
        )

        self.assertFalse(changed)

        self.assertEqual(
            modifier.source(),
            """export class AppService {
  constructor(private readonly logger: Logger) {}
}
""",
        )

    def test_change_is_not_saved_automatically(
        self,
    ) -> None:
        original = """export class AppService {
  constructor(private readonly config: ConfigService) {}
}
"""

        modifier = self.create_modifier(
            original
        )

        modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="Logger",
            )
        )

        self.assertEqual(
            self.path.read_text(
                encoding="utf-8"
            ),
            original,
        )

        self.assertTrue(
            modifier.has_changes()
        )

    def test_save_single_line_conversion(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(private readonly config: ConfigService) {}
}
"""
        )

        modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="Logger",
            )
        )

        self.assertTrue(modifier.save())

        self.assertEqual(
            self.path.read_text(
                encoding="utf-8"
            ),
            modifier.source(),
        )

        self.assertFalse(
            modifier.has_changes()
        )


if __name__ == "__main__":
    unittest.main()
