from __future__ import annotations

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
