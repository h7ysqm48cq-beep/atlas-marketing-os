from __future__ import annotations

from patch_lib import PatchContext


MANIFEST = {
    "id": "009A",
    "name": "TypeScript Text Edit Engine",
    "version": "0.9.0",
    "requires": ["008A", "008B"],
    "description": (
        "Adds a reusable position-based text editing engine for "
        "TypeScript AST modifiers."
    ),
    "build": [
        [
            "python3",
            "-m",
            "unittest",
            "tools.tests.test_text_edit",
        ],
    ],
}


TEXT_EDIT_SOURCE = r'''from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


class TextEditError(RuntimeError):
    """Base error raised by the text edit engine."""


class InvalidTextEdit(TextEditError):
    """Raised when an edit contains invalid source positions."""


class OverlappingTextEdit(TextEditError):
    """Raised when two edits modify overlapping source ranges."""


@dataclass(frozen=True, slots=True)
class TextEdit:
    """
    Replace the source range ``start:end`` with ``replacement``.

    Positions use Python string offsets and follow the same convention
    as the TypeScript parser:

        start: inclusive
        end: exclusive

    An insertion is represented by:

        start == end

    A deletion is represented by:

        replacement == ""
    """

    start: int
    end: int
    replacement: str

    def __post_init__(self) -> None:
        if isinstance(self.start, bool) or not isinstance(
            self.start,
            int,
        ):
            raise TypeError("start must be an integer")

        if isinstance(self.end, bool) or not isinstance(
            self.end,
            int,
        ):
            raise TypeError("end must be an integer")

        if not isinstance(self.replacement, str):
            raise TypeError("replacement must be a string")

        if self.start < 0:
            raise InvalidTextEdit(
                "start cannot be negative"
            )

        if self.end < self.start:
            raise InvalidTextEdit(
                "end cannot be smaller than start"
            )

    @property
    def is_insert(self) -> bool:
        return self.start == self.end and bool(self.replacement)

    @property
    def is_delete(self) -> bool:
        return self.end > self.start and self.replacement == ""

    @property
    def is_replace(self) -> bool:
        return self.end > self.start and bool(self.replacement)

    @property
    def length(self) -> int:
        return self.end - self.start

    def validate_for(self, source: str) -> None:
        if not isinstance(source, str):
            raise TypeError("source must be a string")

        if self.start > len(source):
            raise InvalidTextEdit(
                f"start position {self.start} exceeds "
                f"source length {len(source)}"
            )

        if self.end > len(source):
            raise InvalidTextEdit(
                f"end position {self.end} exceeds "
                f"source length {len(source)}"
            )

    def apply(self, source: str) -> str:
        self.validate_for(source)

        return (
            source[:self.start]
            + self.replacement
            + source[self.end:]
        )


@dataclass(frozen=True, slots=True)
class InsertEdit:
    """Insert text at a source position."""

    position: int
    text: str

    def to_text_edit(self) -> TextEdit:
        return TextEdit(
            start=self.position,
            end=self.position,
            replacement=self.text,
        )


@dataclass(frozen=True, slots=True)
class ReplaceEdit:
    """Replace an existing source range."""

    start: int
    end: int
    text: str

    def to_text_edit(self) -> TextEdit:
        return TextEdit(
            start=self.start,
            end=self.end,
            replacement=self.text,
        )


@dataclass(frozen=True, slots=True)
class DeleteEdit:
    """Delete an existing source range."""

    start: int
    end: int

    def to_text_edit(self) -> TextEdit:
        return TextEdit(
            start=self.start,
            end=self.end,
            replacement="",
        )


EditInput = TextEdit | InsertEdit | ReplaceEdit | DeleteEdit


def normalize_edit(edit: EditInput) -> TextEdit:
    if isinstance(edit, TextEdit):
        return edit

    if isinstance(
        edit,
        (InsertEdit, ReplaceEdit, DeleteEdit),
    ):
        return edit.to_text_edit()

    raise TypeError(
        "edit must be TextEdit, InsertEdit, "
        "ReplaceEdit or DeleteEdit"
    )


def _validate_no_overlaps(
    edits: list[TextEdit],
) -> None:
    """
    Validate edits in ascending source order.

    Insertions at the same position are rejected because their final
    ordering would otherwise be ambiguous.
    """

    ordered = sorted(
        edits,
        key=lambda item: (
            item.start,
            item.end,
        ),
    )

    previous: TextEdit | None = None

    for current in ordered:
        if previous is None:
            previous = current
            continue

        if (
            previous.start == previous.end
            and current.start == current.end
            and previous.start == current.start
        ):
            raise OverlappingTextEdit(
                "Multiple insertions at the same position "
                f"are ambiguous: {current.start}"
            )

        if current.start < previous.end:
            raise OverlappingTextEdit(
                "Text edits overlap: "
                f"{previous.start}:{previous.end} and "
                f"{current.start}:{current.end}"
            )

        previous = current


def apply_text_edits(
    source: str,
    edits: Iterable[EditInput],
) -> str:
    """
    Apply multiple edits safely.

    Edits are validated against the original source and then applied
    from right to left. This prevents an earlier edit from shifting
    the positions of later edits.
    """

    if not isinstance(source, str):
        raise TypeError("source must be a string")

    normalized = [
        normalize_edit(edit)
        for edit in edits
    ]

    for edit in normalized:
        edit.validate_for(source)

    _validate_no_overlaps(normalized)

    result = source

    for edit in sorted(
        normalized,
        key=lambda item: (
            item.start,
            item.end,
        ),
        reverse=True,
    ):
        result = edit.apply(result)

    return result


class TextEditBuffer:
    """
    Mutable in-memory source buffer using immutable TextEdit objects.
    """

    def __init__(self, source: str) -> None:
        if not isinstance(source, str):
            raise TypeError("source must be a string")

        self._original_source = source
        self._source = source
        self._edits: list[TextEdit] = []

    def original_source(self) -> str:
        return self._original_source

    def source(self) -> str:
        return self._source

    def edits(self) -> tuple[TextEdit, ...]:
        return tuple(self._edits)

    def has_changes(self) -> bool:
        return self._source != self._original_source

    def apply(
        self,
        edits: Iterable[EditInput],
    ) -> bool:
        normalized = [
            normalize_edit(edit)
            for edit in edits
        ]

        if not normalized:
            return False

        updated = apply_text_edits(
            self._source,
            normalized,
        )

        if updated == self._source:
            return False

        self._source = updated
        self._edits.extend(normalized)
        return True

    def reset(self) -> None:
        self._source = self._original_source
        self._edits.clear()

    def commit(self) -> None:
        self._original_source = self._source
        self._edits.clear()
'''.strip() + "\n"


TEST_SOURCE = r'''from __future__ import annotations

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
'''.strip() + "\n"


def apply(context: PatchContext) -> None:
    context.write_text(
        "tools/modifier/text_edit.py",
        TEXT_EDIT_SOURCE,
    )

    context.write_text(
        "tools/tests/test_text_edit.py",
        TEST_SOURCE,
    )
