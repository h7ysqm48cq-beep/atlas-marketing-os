from __future__ import annotations

from types import SimpleNamespace

import pytest

from tools.modifier.bridge_editor import (
    BridgeEditor,
    BridgeEditorError,
    BridgeSourceMismatch,
    InvalidBridgePosition,
    utf16_length,
    utf16_offset_to_python_index,
)


class TestUtf16Helpers:
    def test_utf16_length_rejects_non_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            utf16_length(123)

    def test_utf16_length_ascii_and_emoji(
        self,
    ) -> None:
        assert utf16_length("alpha") == 5
        assert utf16_length("😀") == 2
        assert utf16_length("a😀b") == 4

    def test_offset_source_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            utf16_offset_to_python_index(
                123,
                0,
            )

    @pytest.mark.parametrize(
        "offset",
        (
            True,
            "1",
            1.5,
        ),
    )
    def test_offset_must_be_integer(
        self,
        offset: object,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="offset must be an integer",
        ):
            utf16_offset_to_python_index(
                "alpha",
                offset,
            )

    def test_negative_offset_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidBridgePosition,
            match="cannot be negative",
        ):
            utf16_offset_to_python_index(
                "alpha",
                -1,
            )

    def test_offset_exceeds_source(
        self,
    ) -> None:
        with pytest.raises(
            InvalidBridgePosition,
            match="exceeds source length",
        ):
            utf16_offset_to_python_index(
                "alpha",
                6,
            )

    def test_offset_inside_surrogate_pair(
        self,
    ) -> None:
        with pytest.raises(
            InvalidBridgePosition,
            match="middle of a surrogate pair",
        ):
            utf16_offset_to_python_index(
                "😀alpha",
                1,
            )

    def test_offset_at_source_end(self) -> None:
        assert (
            utf16_offset_to_python_index(
                "😀alpha",
                7,
            )
            == 6
        )


class TestInitializationAndMetadata:
    def test_source_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            BridgeEditor(123)

    def test_bridge_file_from_object(self) -> None:
        bridge_result = SimpleNamespace(
            file={
                "lineCount": 2,
            }
        )

        editor = BridgeEditor(
            "one\ntwo",
            bridge_result,
        )

        assert editor._bridge_file() == {
            "lineCount": 2,
        }

    def test_bridge_file_from_mapping(
        self,
    ) -> None:
        editor = BridgeEditor(
            "one",
            {
                "file": {
                    "lineCount": 1,
                },
            },
        )

        assert editor._bridge_file() == {
            "lineCount": 1,
        }

    def test_bridge_file_missing(self) -> None:
        editor = BridgeEditor(
            "one",
            {
                "other": {},
            },
        )

        assert editor._bridge_file() is None

    def test_bridge_file_non_mapping(
        self,
    ) -> None:
        bridge_result = SimpleNamespace(
            file="invalid"
        )

        editor = BridgeEditor(
            "one",
            bridge_result,
        )

        assert editor._bridge_file() is None

    def test_empty_file_metadata_skipped(
        self,
    ) -> None:
        editor = BridgeEditor(
            "one",
            {
                "file": {},
            },
        )

        assert editor.source() == "one"

    def test_line_count_missing_skipped(
        self,
    ) -> None:
        editor = BridgeEditor(
            "one",
            {
                "file": {
                    "path": "sample.ts",
                },
            },
        )

        assert editor.source() == "one"

    def test_line_count_mismatch_rejected(
        self,
    ) -> None:
        with pytest.raises(
            BridgeSourceMismatch,
            match="line counts differ",
        ):
            BridgeEditor(
                "one\ntwo",
                {
                    "file": {
                        "lineCount": 1,
                    },
                },
            )


class TestEditorValidation:
    def test_has_pending_false_and_true(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        assert editor.has_pending_edits() is False
        assert editor.pending_count() == 0

        editor.insert(0, "x")

        assert editor.has_pending_edits() is True
        assert editor.pending_count() == 1

    def test_insert_text_must_be_string(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            editor.insert(0, 123)

    def test_replace_text_must_be_string(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        with pytest.raises(
            TypeError,
            match="text must be a string",
        ):
            editor.replace(
                0,
                1,
                123,
            )

    def test_replace_end_before_start(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        with pytest.raises(
            InvalidBridgePosition,
            match="end position cannot be before",
        ):
            editor.replace(
                4,
                2,
                "x",
            )

    def test_delete_end_before_start(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        with pytest.raises(
            InvalidBridgePosition,
            match="end position cannot be before",
        ):
            editor.delete(
                4,
                2,
            )

    def test_apply_without_pending_returns_false(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        assert editor.apply() is False

    def test_commit_with_pending_rejected(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        editor.insert(0, "x")

        with pytest.raises(
            BridgeEditorError,
            match="still pending",
        ):
            editor.commit()


class TestEditingLifecycle:
    def test_insert_replace_delete_and_apply(
        self,
    ) -> None:
        editor = BridgeEditor(
            "alpha beta gamma"
        )

        editor.replace(
            0,
            5,
            "ALPHA",
        )
        editor.delete(
            6,
            11,
        )
        editor.insert(
            utf16_length(
                "alpha beta gamma"
            ),
            "!",
        )

        assert editor.pending_count() == 3
        assert editor.apply() is True

        assert editor.source() == (
            "ALPHA gamma!"
        )
        assert editor.pending_count() == 0
        assert editor.has_pending_edits() is False
        assert editor.has_changes() is True

    def test_apply_noop_edit_returns_false(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        editor.replace(
            0,
            5,
            "alpha",
        )

        assert editor.apply() is False
        assert editor.pending_count() == 0
        assert editor.has_changes() is False

    def test_reset_discards_pending_and_applied(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        editor.insert(5, " beta")
        assert editor.apply() is True

        editor.insert(0, "x")

        editor.reset()

        assert editor.source() == "alpha"
        assert editor.original_source() == "alpha"
        assert editor.pending_count() == 0
        assert editor.has_changes() is False

    def test_commit_updates_baseline(
        self,
    ) -> None:
        editor = BridgeEditor("alpha")

        editor.insert(5, " beta")
        assert editor.apply() is True

        editor.commit()

        assert editor.source() == (
            "alpha beta"
        )
        assert editor.original_source() == (
            "alpha beta"
        )
        assert editor.has_changes() is False

    def test_utf16_edit_positions(
        self,
    ) -> None:
        editor = BridgeEditor(
            "😀alpha"
        )

        editor.replace(
            2,
            7,
            "beta",
        )

        assert editor.apply() is True
        assert editor.source() == "😀beta"
