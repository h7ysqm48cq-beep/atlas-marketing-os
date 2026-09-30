from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "009B",
    "name": "TypeScript Bridge Editor",
    "version": "0.9.1",
    "requires": ["009A"],
    "description": (
        "Connects TypeScript AST UTF-16 source positions to the "
        "Atlas text edit engine."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_bridge_editor",
        ],
    ],
}


BRIDGE_EDITOR_SOURCE = r'''from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .text_edit import (
    DeleteEdit,
    EditInput,
    InsertEdit,
    ReplaceEdit,
    TextEditBuffer,
)


class BridgeEditorError(RuntimeError):
    """Base error raised by BridgeEditor."""


class InvalidBridgePosition(BridgeEditorError):
    """Raised when a TypeScript AST position is invalid."""


class BridgeSourceMismatch(BridgeEditorError):
    """Raised when bridge metadata does not match the source."""


def utf16_length(text: str) -> int:
    """
    Return the number of UTF-16 code units in a Python string.

    TypeScript compiler positions are measured using UTF-16 code units,
    while Python string indexes are measured using Unicode code points.
    """

    if not isinstance(text, str):
        raise TypeError("text must be a string")

    return len(text.encode("utf-16-le")) // 2


def utf16_offset_to_python_index(
    source: str,
    offset: int,
) -> int:
    """
    Convert a TypeScript UTF-16 source offset to a Python string index.

    Raises InvalidBridgePosition when the offset is outside the source
    or points into the middle of a UTF-16 surrogate pair.
    """

    if not isinstance(source, str):
        raise TypeError("source must be a string")

    if isinstance(offset, bool) or not isinstance(offset, int):
        raise TypeError("offset must be an integer")

    if offset < 0:
        raise InvalidBridgePosition(
            "UTF-16 offset cannot be negative"
        )

    consumed = 0

    for index, character in enumerate(source):
        if consumed == offset:
            return index

        width = utf16_length(character)
        next_consumed = consumed + width

        if consumed < offset < next_consumed:
            raise InvalidBridgePosition(
                f"UTF-16 offset {offset} points into the middle "
                "of a surrogate pair"
            )

        consumed = next_consumed

    if consumed == offset:
        return len(source)

    raise InvalidBridgePosition(
        f"UTF-16 offset {offset} exceeds source length "
        f"{consumed}"
    )


class BridgeEditor:
    """
    Position-based editor for TypeScript Bridge results.

    Public positions passed to insert(), replace() and delete() must be
    TypeScript AST positions measured in UTF-16 code units.

    Edits are queued first and applied together. Applying them together
    ensures that every position refers to the same original source.
    """

    def __init__(
        self,
        source: str,
        bridge_result: Any | None = None,
    ) -> None:
        if not isinstance(source, str):
            raise TypeError("source must be a string")

        self.bridge_result = bridge_result
        self._buffer = TextEditBuffer(source)
        self._pending: list[EditInput] = []

        self._validate_bridge_source()

    def _bridge_file(self) -> Mapping[str, Any] | None:
        if self.bridge_result is None:
            return None

        file_info = getattr(
            self.bridge_result,
            "file",
            None,
        )

        if file_info is None and isinstance(
            self.bridge_result,
            Mapping,
        ):
            file_info = self.bridge_result.get("file")

        if isinstance(file_info, Mapping):
            return file_info

        return None

    def _validate_bridge_source(self) -> None:
        """
        Validate line count when the bridge provides that metadata.

        Byte size is deliberately not compared because parser.js reports
        UTF-8 bytes while Python operates on Unicode strings.
        """

        file_info = self._bridge_file()

        if not file_info:
            return

        expected_line_count = file_info.get("lineCount")

        if expected_line_count is None:
            return

        actual_line_count = (
            self._buffer.source().count("\n") + 1
        )

        if expected_line_count != actual_line_count:
            raise BridgeSourceMismatch(
                "Bridge result and source line counts differ: "
                f"bridge={expected_line_count}, "
                f"source={actual_line_count}"
            )

    def _python_index(
        self,
        utf16_position: int,
    ) -> int:
        return utf16_offset_to_python_index(
            self._buffer.source(),
            utf16_position,
        )

    def source(self) -> str:
        return self._buffer.source()

    def original_source(self) -> str:
        return self._buffer.original_source()

    def pending_count(self) -> int:
        return len(self._pending)

    def has_pending_edits(self) -> bool:
        return bool(self._pending)

    def has_changes(self) -> bool:
        return self._buffer.has_changes()

    def insert(
        self,
        position: int,
        text: str,
    ) -> "BridgeEditor":
        if not isinstance(text, str):
            raise TypeError("text must be a string")

        self._pending.append(
            InsertEdit(
                position=self._python_index(position),
                text=text,
            )
        )

        return self

    def replace(
        self,
        start: int,
        end: int,
        text: str,
    ) -> "BridgeEditor":
        if not isinstance(text, str):
            raise TypeError("text must be a string")

        python_start = self._python_index(start)
        python_end = self._python_index(end)

        if python_end < python_start:
            raise InvalidBridgePosition(
                "end position cannot be before start position"
            )

        self._pending.append(
            ReplaceEdit(
                start=python_start,
                end=python_end,
                text=text,
            )
        )

        return self

    def delete(
        self,
        start: int,
        end: int,
    ) -> "BridgeEditor":
        python_start = self._python_index(start)
        python_end = self._python_index(end)

        if python_end < python_start:
            raise InvalidBridgePosition(
                "end position cannot be before start position"
            )

        self._pending.append(
            DeleteEdit(
                start=python_start,
                end=python_end,
            )
        )

        return self

    def apply(self) -> bool:
        """
        Apply all queued edits to the in-memory source.

        Returns True when the source changed.
        """

        if not self._pending:
            return False

        pending = tuple(self._pending)

        changed = self._buffer.apply(pending)
        self._pending.clear()

        return changed

    def reset(self) -> None:
        """
        Discard applied and pending changes.
        """

        self._pending.clear()
        self._buffer.reset()

    def commit(self) -> None:
        """
        Mark the current source as the new clean baseline.
        """

        if self._pending:
            raise BridgeEditorError(
                "Cannot commit while edits are still pending"
            )

        self._buffer.commit()
'''.strip() + "\n"


TEST_SOURCE = r'''from __future__ import annotations

import unittest

from tools.modifier.bridge_editor import (
    BridgeEditor,
    BridgeEditorError,
    BridgeSourceMismatch,
    InvalidBridgePosition,
    utf16_length,
    utf16_offset_to_python_index,
)


class BridgeEditorTests(unittest.TestCase):
    def test_ascii_utf16_offset(self) -> None:
        self.assertEqual(
            utf16_offset_to_python_index(
                "Atlas",
                3,
            ),
            3,
        )

    def test_emoji_utf16_offset(self) -> None:
        source = "A😀B"

        self.assertEqual(utf16_length(source), 4)

        self.assertEqual(
            utf16_offset_to_python_index(
                source,
                3,
            ),
            2,
        )

    def test_surrogate_middle_is_rejected(self) -> None:
        with self.assertRaises(
            InvalidBridgePosition
        ):
            utf16_offset_to_python_index(
                "A😀B",
                2,
            )

    def test_insert_using_utf16_position(self) -> None:
        editor = BridgeEditor("A😀B")

        editor.insert(
            position=3,
            text="!",
        )

        self.assertTrue(editor.apply())
        self.assertEqual(
            editor.source(),
            "A😀!B",
        )

    def test_replace(self) -> None:
        editor = BridgeEditor(
            "constructor() {}"
        )

        editor.replace(
            start=0,
            end=11,
            text="create",
        )

        editor.apply()

        self.assertEqual(
            editor.source(),
            "create() {}",
        )

    def test_delete(self) -> None:
        editor = BridgeEditor(
            "private readonly config"
        )

        editor.delete(
            start=0,
            end=8,
        )

        editor.apply()

        self.assertEqual(
            editor.source(),
            "readonly config",
        )

    def test_multiple_edits_use_original_positions(self) -> None:
        editor = BridgeEditor("abcdef")

        editor.replace(
            start=1,
            end=3,
            text="BC",
        )

        editor.insert(
            position=6,
            text="!",
        )

        editor.apply()

        self.assertEqual(
            editor.source(),
            "aBCdef!",
        )

    def test_apply_without_pending_edits(self) -> None:
        editor = BridgeEditor("Atlas")

        self.assertFalse(editor.apply())
        self.assertEqual(
            editor.source(),
            "Atlas",
        )

    def test_reset_discards_changes(self) -> None:
        editor = BridgeEditor("Atlas")

        editor.insert(
            position=5,
            text=" OS",
        )

        editor.apply()
        editor.reset()

        self.assertEqual(
            editor.source(),
            "Atlas",
        )

        self.assertFalse(
            editor.has_changes()
        )

    def test_pending_edits_are_discarded_by_reset(self) -> None:
        editor = BridgeEditor("Atlas")

        editor.insert(
            position=5,
            text=" OS",
        )

        editor.reset()

        self.assertEqual(
            editor.pending_count(),
            0,
        )

        self.assertEqual(
            editor.source(),
            "Atlas",
        )

    def test_commit_requires_applied_edits(self) -> None:
        editor = BridgeEditor("Atlas")

        editor.insert(
            position=5,
            text=" OS",
        )

        with self.assertRaises(
            BridgeEditorError
        ):
            editor.commit()

    def test_commit_sets_new_baseline(self) -> None:
        editor = BridgeEditor("Atlas")

        editor.insert(
            position=5,
            text=" OS",
        )

        editor.apply()
        editor.commit()

        self.assertEqual(
            editor.original_source(),
            "Atlas OS",
        )

        self.assertFalse(
            editor.has_changes()
        )

    def test_bridge_line_count_validation(self) -> None:
        bridge_result = {
            "file": {
                "lineCount": 3,
            }
        }

        with self.assertRaises(
            BridgeSourceMismatch
        ):
            BridgeEditor(
                "line one\nline two",
                bridge_result,
            )

    def test_matching_bridge_line_count(self) -> None:
        bridge_result = {
            "file": {
                "lineCount": 2,
            }
        }

        editor = BridgeEditor(
            "line one\nline two",
            bridge_result,
        )

        self.assertEqual(
            editor.source(),
            "line one\nline two",
        )


if __name__ == "__main__":
    unittest.main()
'''.strip() + "\n"


EXPORT_BLOCK = r'''from .bridge_editor import (
    BridgeEditor,
    BridgeEditorError,
    BridgeSourceMismatch,
    InvalidBridgePosition,
    utf16_length,
    utf16_offset_to_python_index,
)'''


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/modifier/bridge_editor.py",
        BRIDGE_EDITOR_SOURCE,
    )

    context.write_text(
        "tools/tests/test_bridge_editor.py",
        TEST_SOURCE,
    )

    context.append_once(
        "tools/modifier/__init__.py",
        EXPORT_BLOCK,
    )
