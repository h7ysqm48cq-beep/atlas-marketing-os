from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "011B",
    "name": "Constructor Modifier Multiline Insert",
    "version": "1.0.0",
    "requires": ["011A"],
    "description": (
        "Implements constructor parameter insertion for multiline "
        "constructors that already contain at least one parameter."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_constructor_modifier_insert",
        ],
    ],
}


OLD_BRIDGE_IMPORT = '''from .bridge import TypeScriptBridge
from .constructor_parameter import ConstructorParameter
'''


NEW_BRIDGE_IMPORT = '''from .bridge import TypeScriptBridge
from .bridge_editor import (
    BridgeEditor,
    utf16_offset_to_python_index,
)
from .constructor_parameter import ConstructorParameter
'''


OLD_ERROR_BLOCK = '''class ConstructorNotFound(ConstructorModifierError):
    """Raised when the target class has no constructor."""


class ConstructorModifier:
'''


NEW_ERROR_BLOCK = '''class ConstructorNotFound(ConstructorModifierError):
    """Raised when the target class has no constructor."""


class UnsupportedConstructorShape(ConstructorModifierError):
    """Raised when the constructor shape is not supported yet."""


class ConstructorModifier:
'''


OLD_ADD_PARAMETER = '''    def add_parameter(
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
'''


NEW_ADD_PARAMETER = '''    def _parse_current_source(self) -> None:
        """
        Parse the current in-memory source without permanently saving it.

        TypeScriptBridge currently parses from a file path, so the
        in-memory source is written temporarily and the original disk
        content is restored immediately afterwards.
        """

        disk_source = self.path.read_text(
            encoding="utf-8"
        )

        if disk_source == self._source:
            self._bridge_result = self.bridge.parse(
                self.path
            )
            return

        self.path.write_text(
            self._source,
            encoding="utf-8",
        )

        try:
            self._bridge_result = self.bridge.parse(
                self.path
            )
        finally:
            self.path.write_text(
                disk_source,
                encoding="utf-8",
            )

    def _python_index(
        self,
        utf16_position: int,
    ) -> int:
        """Convert a TypeScript UTF-16 position into a Python index."""

        return utf16_offset_to_python_index(
            self._source,
            utf16_position,
        )

    def _line_indent(
        self,
        python_index: int,
    ) -> str:
        """Return the whitespace indentation of the containing line."""

        line_start = self._source.rfind(
            "\\n",
            0,
            python_index,
        ) + 1

        cursor = line_start

        while (
            cursor < len(self._source)
            and self._source[cursor] in (" ", "\\t")
        ):
            cursor += 1

        return self._source[
            line_start:cursor
        ]

    def _utf16_position(
        self,
        python_index: int,
    ) -> int:
        """Convert a Python source index into a UTF-16 position."""

        return (
            len(
                self._source[
                    :python_index
                ].encode("utf-16-le")
            )
            // 2
        )

    def add_parameter(
        self,
        parameter: ConstructorParameter,
    ) -> bool:
        """
        Add a parameter to a multiline constructor.

        Patch 011B supports constructors that already contain at least
        one parameter. Empty and single-line constructors are handled
        by later patches.

        Returns False when a parameter with the same name already
        exists.
        """

        if not isinstance(
            parameter,
            ConstructorParameter,
        ):
            raise TypeError(
                "parameter must be a ConstructorParameter"
            )

        constructor = self.constructor_node()

        if constructor.has_parameter(
            parameter.name
        ):
            return False

        last_parameter = (
            constructor.last_parameter()
        )

        if last_parameter is None:
            raise UnsupportedConstructorShape(
                "Patch 011B does not yet support "
                "empty constructors"
            )

        constructor_start = self._python_index(
            constructor.start
        )

        parameter_end = self._python_index(
            last_parameter.end
        )

        body_start = self._python_index(
            constructor.body_start
        )

        constructor_header = self._source[
            constructor_start:body_start
        ]

        if "\\n" not in constructor_header:
            raise UnsupportedConstructorShape(
                "Patch 011B only supports "
                "multiline constructors"
            )

        parameter_indent = self._line_indent(
            self._python_index(
                last_parameter.start
            )
        )

        rendered = parameter.render_typescript()

        tail = self._source[
            parameter_end:body_start
        ]

        comma_relative = None

        for index, character in enumerate(tail):
            if character.isspace():
                continue

            if character == ",":
                comma_relative = index

            break

        if comma_relative is not None:
            insertion_index = (
                parameter_end
                + comma_relative
                + 1
            )

            insertion_text = (
                "\\n"
                f"{parameter_indent}"
                f"{rendered},"
            )
        else:
            insertion_index = parameter_end

            insertion_text = (
                ",\\n"
                f"{parameter_indent}"
                f"{rendered}"
            )

        editor = BridgeEditor(
            source=self._source,
            bridge_result=self.bridge_result(),
        )

        editor.insert(
            position=self._utf16_position(
                insertion_index
            ),
            text=insertion_text,
        )

        changed = editor.apply()

        if not changed:
            return False

        self._source = editor.source()
        self._parse_current_source()

        return True
'''


OLD_EXPORT_BLOCK = '''from .typescript_constructor import (
    ConstructorModifier,
    ConstructorModifierError,
    ConstructorNotFound,
)'''


NEW_EXPORT_BLOCK = '''from .typescript_constructor import (
    ConstructorModifier,
    ConstructorModifierError,
    ConstructorNotFound,
    UnsupportedConstructorShape,
)'''


TEST_SOURCE = r'''from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.modifier import (
    ConstructorModifier,
    ConstructorParameter,
    UnsupportedConstructorShape,
)


def utf16_offset(
    source: str,
    python_index: int,
) -> int:
    return (
        len(
            source[:python_index].encode(
                "utf-16-le"
            )
        )
        // 2
    )


class FakeBridge:
    def parse(self, path: Path) -> dict:
        source = Path(path).read_text(
            encoding="utf-8"
        )

        class_start = source.index(
            "export class AppService"
        )

        constructor_start = source.index(
            "constructor"
        )

        opening = source.index(
            "(",
            constructor_start,
        )

        closing = source.index(
            ")",
            opening,
        )

        body_start = source.index(
            "{",
            closing,
        )

        body_end = source.index(
            "}",
            body_start,
        ) + 1

        interior = source[
            opening + 1:
            closing
        ]

        parameters = []

        for name, parameter_type in (
            ("config", "ConfigService"),
            ("logger", "Logger"),
            ("atlasBrain", "AtlasBrainService"),
        ):
            name_relative = interior.find(name)

            if name_relative < 0:
                continue

            name_index = (
                opening
                + 1
                + name_relative
            )

            parameter_start = name_index

            while (
                parameter_start > opening + 1
                and source[
                    parameter_start - 1
                ] not in (",", "\n")
            ):
                parameter_start -= 1

            while (
                parameter_start < name_index
                and source[
                    parameter_start
                ].isspace()
            ):
                parameter_start += 1

            parameter_end = name_index

            while (
                parameter_end < closing
                and source[
                    parameter_end
                ] not in (",", "\n")
            ):
                parameter_end += 1

            parameters.append(
                {
                    "name": name,
                    "type": parameter_type,
                    "start": utf16_offset(
                        source,
                        parameter_start,
                    ),
                    "end": utf16_offset(
                        source,
                        parameter_end,
                    ),
                    "modifiers": [
                        "private",
                        "readonly",
                    ],
                    "decorators": [],
                }
            )

        parameters.sort(
            key=lambda value: value["start"]
        )

        return {
            "file": {
                "lineCount": (
                    source.count("\n") + 1
                ),
            },
            "classes": [
                {
                    "name": "AppService",
                    "start": utf16_offset(
                        source,
                        class_start,
                    ),
                    "end": utf16_offset(
                        source,
                        len(source),
                    ),
                    "constructors": [
                        {
                            "start": utf16_offset(
                                source,
                                constructor_start,
                            ),
                            "end": utf16_offset(
                                source,
                                body_end,
                            ),
                            "bodyStart": utf16_offset(
                                source,
                                body_start,
                            ),
                            "bodyEnd": utf16_offset(
                                source,
                                body_end,
                            ),
                            "parameters": parameters,
                        }
                    ],
                }
            ],
        }


class ConstructorModifierInsertTests(
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

    def test_add_parameter_with_trailing_comma(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
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

    def test_add_parameter_without_trailing_comma(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService
  ) {}
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
    private readonly logger: Logger
  ) {}
}
""",
        )

    def test_duplicate_returns_false(self) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""
        )

        changed = modifier.add_parameter(
            ConstructorParameter(
                name="config",
                type="AnotherConfig",
            )
        )

        self.assertFalse(changed)
        self.assertFalse(
            modifier.has_changes()
        )

    def test_added_parameter_is_reparsed(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
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
            [
                "config",
                "logger",
            ],
        )

    def test_change_is_not_saved_automatically(
        self,
    ) -> None:
        source = """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""

        modifier = self.create_modifier(source)

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
            source,
        )

        self.assertTrue(
            modifier.has_changes()
        )

    def test_save_writes_change(self) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
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
            modifier.save()
        )

        self.assertEqual(
            self.path.read_text(
                encoding="utf-8"
            ),
            modifier.source(),
        )

        self.assertFalse(
            modifier.has_changes()
        )

    def test_empty_constructor_is_not_supported(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor() {}
}
"""
        )

        with self.assertRaises(
            UnsupportedConstructorShape
        ):
            modifier.add_parameter(
                ConstructorParameter(
                    name="logger",
                    type="Logger",
                )
            )

    def test_single_line_is_not_supported(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(private readonly config: ConfigService) {}
}
"""
        )

        with self.assertRaises(
            UnsupportedConstructorShape
        ):
            modifier.add_parameter(
                ConstructorParameter(
                    name="logger",
                    type="Logger",
                )
            )

    def test_wrong_parameter_type_is_rejected(
        self,
    ) -> None:
        modifier = self.create_modifier(
            """export class AppService {
  constructor(
    private readonly config: ConfigService,
  ) {}
}
"""
        )

        with self.assertRaises(TypeError):
            modifier.add_parameter(
                "private readonly logger: Logger"
            )


if __name__ == "__main__":
    unittest.main()
'''.strip() + "\n"


def apply(context: PatchContext) -> None:
    context.replace_once(
        "tools/modifier/typescript_constructor.py",
        OLD_BRIDGE_IMPORT,
        NEW_BRIDGE_IMPORT,
    )

    context.replace_once(
        "tools/modifier/typescript_constructor.py",
        OLD_ERROR_BLOCK,
        NEW_ERROR_BLOCK,
    )

    context.replace_once(
        "tools/modifier/typescript_constructor.py",
        OLD_ADD_PARAMETER,
        NEW_ADD_PARAMETER,
    )

    context.replace_once(
        "tools/modifier/__init__.py",
        OLD_EXPORT_BLOCK,
        NEW_EXPORT_BLOCK,
    )

    context.write_text(
        "tools/tests/test_constructor_modifier_insert.py",
        TEST_SOURCE,
    )
