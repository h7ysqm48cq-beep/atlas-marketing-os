from __future__ import annotations

import pytest

from tools.modifier.text_edit import (
    DeleteEdit,
    InsertEdit,
    InvalidTextEdit,
    ReplaceEdit,
    TextEdit,
    TextEditBuffer,
    apply_text_edits,
    normalize_edit,
)


class TestTextEditValidation:
    @pytest.mark.parametrize(
        "value",
        (True, "0", 1.5),
    )
    def test_start_must_be_integer(
        self,
        value: object,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="start must be an integer",
        ):
            TextEdit(
                start=value,
                end=1,
                replacement="x",
            )

    @pytest.mark.parametrize(
        "value",
        (True, "1", 1.5),
    )
    def test_end_must_be_integer(
        self,
        value: object,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="end must be an integer",
        ):
            TextEdit(
                start=0,
                end=value,
                replacement="x",
            )

    def test_replacement_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="replacement must be a string",
        ):
            TextEdit(
                start=0,
                end=1,
                replacement=123,
            )

    def test_negative_start_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidTextEdit,
            match="start cannot be negative",
        ):
            TextEdit(
                start=-1,
                end=0,
                replacement="x",
            )

    def test_end_before_start_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidTextEdit,
            match="smaller than start",
        ):
            TextEdit(
                start=2,
                end=1,
                replacement="x",
            )


class TestTextEditProperties:
    def test_insert_properties(self) -> None:
        edit = TextEdit(
            start=1,
            end=1,
            replacement="x",
        )

        assert edit.is_insert is True
        assert edit.is_delete is False
        assert edit.is_replace is False
        assert edit.length == 0

    def test_delete_properties(self) -> None:
        edit = TextEdit(
            start=1,
            end=3,
            replacement="",
        )

        assert edit.is_insert is False
        assert edit.is_delete is True
        assert edit.is_replace is False
        assert edit.length == 2

    def test_replace_properties(self) -> None:
        edit = TextEdit(
            start=1,
            end=3,
            replacement="xy",
        )

        assert edit.is_insert is False
        assert edit.is_delete is False
        assert edit.is_replace is True
        assert edit.length == 2

    def test_empty_zero_length_edit_properties(
        self,
    ) -> None:
        edit = TextEdit(
            start=1,
            end=1,
            replacement="",
        )

        assert edit.is_insert is False
        assert edit.is_delete is False
        assert edit.is_replace is False
        assert edit.length == 0


class TestValidationForSource:
    def test_source_must_be_string(
        self,
    ) -> None:
        edit = TextEdit(
            start=0,
            end=0,
            replacement="x",
        )

        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            edit.validate_for(123)

    def test_start_exceeds_source(
        self,
    ) -> None:
        edit = TextEdit(
            start=6,
            end=6,
            replacement="x",
        )

        with pytest.raises(
            InvalidTextEdit,
            match="start position 6 exceeds",
        ):
            edit.validate_for("alpha")

    def test_end_exceeds_source(
        self,
    ) -> None:
        edit = TextEdit(
            start=0,
            end=6,
            replacement="x",
        )

        with pytest.raises(
            InvalidTextEdit,
            match="end position 6 exceeds",
        ):
            edit.validate_for("alpha")

    def test_apply_valid_edit(self) -> None:
        edit = TextEdit(
            start=1,
            end=4,
            replacement="XYZ",
        )

        assert edit.apply("alpha") == "aXYZa"


class TestEditAdapters:
    def test_insert_to_text_edit(self) -> None:
        edit = InsertEdit(
            position=2,
            text="x",
        ).to_text_edit()

        assert edit == TextEdit(
            start=2,
            end=2,
            replacement="x",
        )

    def test_replace_to_text_edit(self) -> None:
        edit = ReplaceEdit(
            start=1,
            end=3,
            text="x",
        ).to_text_edit()

        assert edit == TextEdit(
            start=1,
            end=3,
            replacement="x",
        )

    def test_delete_to_text_edit(self) -> None:
        edit = DeleteEdit(
            start=1,
            end=3,
        ).to_text_edit()

        assert edit == TextEdit(
            start=1,
            end=3,
            replacement="",
        )


class TestNormalizeEdit:
    def test_text_edit_returned_directly(
        self,
    ) -> None:
        edit = TextEdit(
            start=0,
            end=1,
            replacement="x",
        )

        assert normalize_edit(edit) is edit

    @pytest.mark.parametrize(
        "edit",
        (
            InsertEdit(
                position=0,
                text="x",
            ),
            ReplaceEdit(
                start=0,
                end=1,
                text="x",
            ),
            DeleteEdit(
                start=0,
                end=1,
            ),
        ),
    )
    def test_supported_edit_types_normalized(
        self,
        edit,
    ) -> None:
        result = normalize_edit(edit)

        assert isinstance(result, TextEdit)

    def test_invalid_edit_type_rejected(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="edit must be TextEdit",
        ):
            normalize_edit("invalid")


class TestApplyTextEdits:
    def test_source_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            apply_text_edits(
                123,
                (),
            )

    def test_empty_edits_return_source(
        self,
    ) -> None:
        assert (
            apply_text_edits(
                "alpha",
                (),
            )
            == "alpha"
        )

    def test_mixed_edits_applied_right_to_left(
        self,
    ) -> None:
        source = "alpha beta gamma"

        result = apply_text_edits(
            source,
            (
                ReplaceEdit(
                    start=0,
                    end=5,
                    text="ALPHA",
                ),
                DeleteEdit(
                    start=6,
                    end=11,
                ),
                InsertEdit(
                    position=len(source),
                    text="!",
                ),
            ),
        )

        assert result == "ALPHA gamma!"


class TestTextEditBuffer:
    def test_source_must_be_string(
        self,
    ) -> None:
        with pytest.raises(
            TypeError,
            match="source must be a string",
        ):
            TextEditBuffer(123)

    def test_initial_state(self) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        assert buffer.original_source() == "alpha"
        assert buffer.source() == "alpha"
        assert buffer.edits() == ()
        assert buffer.has_changes() is False

    def test_empty_apply_returns_false(
        self,
    ) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        assert buffer.apply(()) is False
        assert buffer.source() == "alpha"
        assert buffer.edits() == ()

    def test_noop_apply_returns_false(
        self,
    ) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        result = buffer.apply(
            (
                ReplaceEdit(
                    start=0,
                    end=5,
                    text="alpha",
                ),
            )
        )

        assert result is False
        assert buffer.source() == "alpha"
        assert buffer.edits() == ()
        assert buffer.has_changes() is False

    def test_changed_apply_records_edit(
        self,
    ) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        result = buffer.apply(
            (
                InsertEdit(
                    position=5,
                    text=" beta",
                ),
            )
        )

        assert result is True
        assert buffer.source() == "alpha beta"
        assert len(buffer.edits()) == 1
        assert buffer.has_changes() is True

    def test_reset_restores_original(
        self,
    ) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        buffer.apply(
            (
                InsertEdit(
                    position=5,
                    text=" beta",
                ),
            )
        )

        buffer.reset()

        assert buffer.source() == "alpha"
        assert buffer.original_source() == "alpha"
        assert buffer.edits() == ()
        assert buffer.has_changes() is False

    def test_commit_updates_baseline(
        self,
    ) -> None:
        buffer = TextEditBuffer(
            "alpha"
        )

        buffer.apply(
            (
                InsertEdit(
                    position=5,
                    text=" beta",
                ),
            )
        )

        buffer.commit()

        assert buffer.source() == "alpha beta"
        assert (
            buffer.original_source()
            == "alpha beta"
        )
        assert buffer.edits() == ()
        assert buffer.has_changes() is False
