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


class ConstructorModifierEmptyTests(
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

    def test_add_first_parameter(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor() {}
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
  constructor() {}
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
            modifier.has_parameter("logger")
        )

        self.assertEqual(
            [
                parameter.name
                for parameter
                in modifier.parameters()
            ],
            ["logger"],
        )

    def test_change_is_not_saved_automatically(
        self,
    ) -> None:
        original = """export class AppService {
  constructor() {}
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

    def test_save_first_parameter(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor() {}
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

    def test_duplicate_after_first_insert(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor() {}
}
"""
        )

        first = modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="Logger",
            )
        )

        second = modifier.add_parameter(
            ConstructorParameter(
                name="logger",
                type="AnotherLogger",
            )
        )

        self.assertTrue(first)
        self.assertFalse(second)

        self.assertEqual(
            modifier.source().count(
                "private readonly logger:"
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
