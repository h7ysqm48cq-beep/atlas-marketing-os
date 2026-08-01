from __future__ import annotations

import unittest

from tools.modifier.text_edit import (
    DeleteEdit,
    InsertEdit,
    InvalidTextEdit,
    OverlappingTextEdit,
    ReplaceEdit,
    TextEdit,
    TextEditBuffer,
    apply_text_edits,
)


class TextEditTests(unittest.TestCase):
    def test_insert_edit(self) -> None:
        source = "Hello world"

        result = InsertEdit(
            position=5,
            text=", Atlas",
        ).to_text_edit().apply(source)

        self.assertEqual(
            result,
            "Hello, Atlas world",
        )

    def test_replace_edit(self) -> None:
        result = ReplaceEdit(
            start=6,
            end=11,
            text="Atlas",
        ).to_text_edit().apply(
            "Hello world"
        )

        self.assertEqual(
            result,
            "Hello Atlas",
        )

    def test_delete_edit(self) -> None:
        result = DeleteEdit(
            start=5,
            end=11,
        ).to_text_edit().apply(
            "Hello world"
        )

        self.assertEqual(result, "Hello")

    def test_multiple_edits_use_original_positions(self) -> None:
        source = "abcdef"

        result = apply_text_edits(
            source,
            [
                ReplaceEdit(
                    start=1,
                    end=3,
                    text="BC",
                ),
                InsertEdit(
                    position=6,
                    text="!",
                ),
            ],
        )

        self.assertEqual(
            result,
            "aBCdef!",
        )

    def test_overlapping_edits_are_rejected(self) -> None:
        with self.assertRaises(
            OverlappingTextEdit
        ):
            apply_text_edits(
                "abcdef",
                [
                    TextEdit(1, 4, "x"),
                    TextEdit(3, 5, "y"),
                ],
            )

    def test_duplicate_insert_position_is_rejected(self) -> None:
        with self.assertRaises(
            OverlappingTextEdit
        ):
            apply_text_edits(
                "abcdef",
                [
                    InsertEdit(3, "x"),
                    InsertEdit(3, "y"),
                ],
            )

    def test_out_of_bounds_edit_is_rejected(self) -> None:
        with self.assertRaises(
            InvalidTextEdit
        ):
            TextEdit(
                start=0,
                end=100,
                replacement="x",
            ).apply("abc")

    def test_buffer_tracks_changes(self) -> None:
        buffer = TextEditBuffer(
            "constructor() {}"
        )

        changed = buffer.apply(
            [
                InsertEdit(
                    position=12,
                    text=(
                        "private readonly "
                        "config: ConfigService"
                    ),
                )
            ]
        )

        self.assertTrue(changed)
        self.assertTrue(buffer.has_changes())
        self.assertEqual(
            buffer.source(),
            (
                "constructor("
                "private readonly config: ConfigService"
                ") {}"
            ),
        )

    def test_buffer_reset(self) -> None:
        buffer = TextEditBuffer("abc")
        buffer.apply([InsertEdit(3, "d")])
        buffer.reset()

        self.assertEqual(buffer.source(), "abc")
        self.assertFalse(buffer.has_changes())
        self.assertEqual(buffer.edits(), ())

    def test_buffer_commit(self) -> None:
        buffer = TextEditBuffer("abc")
        buffer.apply([InsertEdit(3, "d")])
        buffer.commit()

        self.assertEqual(
            buffer.original_source(),
            "abcd",
        )
        self.assertFalse(buffer.has_changes())
        self.assertEqual(buffer.edits(), ())


if __name__ == "__main__":
    unittest.main()
