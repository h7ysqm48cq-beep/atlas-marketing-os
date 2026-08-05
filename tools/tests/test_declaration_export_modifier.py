from __future__ import annotations

import pytest

from tools.modifier.ast_navigator import (
    ExportedDeclarationNode,
)
from tools.modifier.declaration_export_modifier import (
    DeclarationExportContext,
    DeclarationExportPlanner,
    DeclarationExportShape,
    InvalidDeclarationExport,
    _consume_horizontal_space_right,
    _python_index,
    _remove_modifier_edit,
    _utf16_length,
    _validate_default_kind,
)


def make_declaration(
    *,
    kind: str = "class",
    name: str = "UserService",
    exported: bool = False,
    default: bool = False,
    modifier_start: int = 0,
    export_modifier_start: int | None = None,
    export_modifier_end: int | None = None,
    default_modifier_start: int | None = None,
    default_modifier_end: int | None = None,
) -> ExportedDeclarationNode:
    return ExportedDeclarationNode(
        raw={
            "kind": kind,
            "name": name,
            "names": [name],
            "exported": exported,
            "default": default,
            "modifierStart": modifier_start,
            "exportModifierStart": export_modifier_start,
            "exportModifierEnd": export_modifier_end,
            "defaultModifierStart": default_modifier_start,
            "defaultModifierEnd": default_modifier_end,
            "declarationStart": modifier_start,
            "declarationEnd": modifier_start + 1,
            "removalStart": modifier_start,
            "removalEnd": modifier_start + 1,
            "variableDeclarators": [],
            "start": modifier_start,
            "end": modifier_start + 1,
        }
    )


def make_context(
    *,
    source: str = "class UserService {}",
    declaration: ExportedDeclarationNode | None = None,
    default: bool = False,
    remove: bool = False,
    default_only: bool = False,
) -> DeclarationExportContext:
    return DeclarationExportContext(
        source=source,
        declaration=(
            declaration
            if declaration is not None
            else make_declaration()
        ),
        default=default,
        remove=remove,
        default_only=default_only,
    )


class TestUtf16Helpers:
    def test_python_index_negative_rejected(
        self,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationExport,
            match="negative",
        ):
            _python_index("alpha", -1)

    def test_python_index_start(self) -> None:
        assert _python_index("alpha", 0) == 0

    def test_python_index_inside_ascii(self) -> None:
        assert _python_index("alpha", 3) == 3

    def test_python_index_at_end(self) -> None:
        assert _python_index("alpha", 5) == 5

    def test_python_index_after_emoji(self) -> None:
        source = "😀alpha"

        assert _python_index(source, 2) == 1
        assert _python_index(source, 3) == 2

    def test_python_index_splits_surrogate_pair(
        self,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationExport,
            match="splits",
        ):
            _python_index("😀alpha", 1)

    def test_python_index_exceeds_source(
        self,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationExport,
            match="exceeds",
        ):
            _python_index("alpha", 6)

    def test_utf16_length(self) -> None:
        assert _utf16_length("alpha") == 5
        assert _utf16_length("😀alpha") == 7

    def test_consume_horizontal_spaces(self) -> None:
        source = "export \t class"

        assert (
            _consume_horizontal_space_right(
                source,
                len("export"),
            )
            == len("export \t ")
        )

    def test_consume_without_spaces(self) -> None:
        source = "export\nclass"

        assert (
            _consume_horizontal_space_right(
                source,
                len("export"),
            )
            == len("export")
        )


class TestRemoveModifierEdit:
    def test_consumes_space_after_modifier(
        self,
    ) -> None:
        source = "export   class UserService {}"

        edit = _remove_modifier_edit(
            source,
            0,
            len("export"),
        )

        assert edit.start == 0
        assert edit.end == len("export   ")
        assert edit.text == ""

    def test_consumes_tab_after_modifier(
        self,
    ) -> None:
        source = "export\tclass UserService {}"

        edit = _remove_modifier_edit(
            source,
            0,
            len("export"),
        )

        assert edit.end == len("export\t")

    def test_consumes_space_before_modifier(
        self,
    ) -> None:
        source = "abstract export"

        start = source.index("export")
        end = start + len("export")

        edit = _remove_modifier_edit(
            source,
            start,
            end,
        )

        assert edit.start == len("abstract")
        assert edit.end == end

    def test_consumes_tab_before_modifier(
        self,
    ) -> None:
        source = "abstract\texport"

        start = source.index("export")
        end = start + len("export")

        edit = _remove_modifier_edit(
            source,
            start,
            end,
        )

        assert edit.start == len("abstract")

    def test_removes_exact_range_without_space(
        self,
    ) -> None:
        source = "\nexport\n"

        start = source.index("export")
        end = start + len("export")

        edit = _remove_modifier_edit(
            source,
            start,
            end,
        )

        assert edit.start == start
        assert edit.end == end


class TestDefaultKindValidation:
    @pytest.mark.parametrize(
        "kind",
        ("class", "function"),
    )
    def test_supported_default_kinds(
        self,
        kind: str,
    ) -> None:
        _validate_default_kind(
            make_declaration(kind=kind)
        )

    @pytest.mark.parametrize(
        "kind",
        (
            "variable",
            "interface",
            "type",
            "enum",
        ),
    )
    def test_unsupported_default_kinds(
        self,
        kind: str,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationExport,
            match="only supported",
        ):
            _validate_default_kind(
                make_declaration(kind=kind)
            )


class TestAddExport:
    def test_wrong_context_type(self) -> None:
        with pytest.raises(
            TypeError,
            match="DeclarationExportContext",
        ):
            DeclarationExportPlanner().plan(
                "invalid"
            )

    def test_default_only_requires_remove(
        self,
    ) -> None:
        with pytest.raises(
            InvalidDeclarationExport,
            match="requires remove",
        ):
            DeclarationExportPlanner().plan(
                make_context(
                    default_only=True,
                )
            )

    def test_add_export(self) -> None:
        declaration = make_declaration(
            modifier_start=0,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                declaration=declaration,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape.ADD_EXPORT
        )
        assert plan.edits[0].start == 0
        assert plan.edits[0].end == 0
        assert plan.edits[0].text == "export "

    def test_add_export_default_class(
        self,
    ) -> None:
        declaration = make_declaration(
            kind="class",
            modifier_start=3,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                declaration=declaration,
                default=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape
            .ADD_EXPORT_DEFAULT
        )
        assert plan.edits[0].start == 3
        assert (
            plan.edits[0].text
            == "export default "
        )

    def test_add_export_default_function(
        self,
    ) -> None:
        declaration = make_declaration(
            kind="function",
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                declaration=declaration,
                default=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape
            .ADD_EXPORT_DEFAULT
        )

    def test_existing_export_is_noop(self) -> None:
        declaration = make_declaration(
            exported=True,
            export_modifier_start=0,
            export_modifier_end=6,
        )

        assert (
            DeclarationExportPlanner().plan(
                make_context(
                    source=(
                        "export class "
                        "UserService {}"
                    ),
                    declaration=declaration,
                )
            )
            is None
        )

    def test_existing_default_export_is_noop(
        self,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=7,
            default_modifier_end=14,
        )

        assert (
            DeclarationExportPlanner().plan(
                make_context(
                    source=(
                        "export default class "
                        "UserService {}"
                    ),
                    declaration=declaration,
                    default=True,
                )
            )
            is None
        )

    def test_add_default_to_existing_export(
        self,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            default=False,
            export_modifier_start=0,
            export_modifier_end=6,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                source=(
                    "export class UserService {}"
                ),
                declaration=declaration,
                default=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape.ADD_DEFAULT
        )
        assert plan.edits[0].start == 6
        assert plan.edits[0].end == 6
        assert plan.edits[0].text == " default"

    def test_add_default_missing_export_end(
        self,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            export_modifier_start=0,
            export_modifier_end=None,
        )

        with pytest.raises(
            InvalidDeclarationExport,
            match="missing",
        ):
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    default=True,
                )
            )


class TestRemoveExport:
    def test_remove_nonexported_is_noop(
        self,
    ) -> None:
        declaration = make_declaration(
            exported=False,
        )

        assert (
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    remove=True,
                )
            )
            is None
        )

    def test_remove_default_only_when_not_default(
        self,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            default=False,
            export_modifier_start=0,
            export_modifier_end=6,
        )

        assert (
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    remove=True,
                    default_only=True,
                )
            )
            is None
        )

    def test_remove_default_only(self) -> None:
        source = (
            "export default class UserService {}"
        )

        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=7,
            default_modifier_end=14,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                remove=True,
                default_only=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape
            .REMOVE_DEFAULT
        )
        assert plan.edits[0].start == 7
        assert plan.edits[0].end == 15

    @pytest.mark.parametrize(
        (
            "default_start",
            "default_end",
        ),
        (
            (None, 14),
            (7, None),
        ),
    )
    def test_remove_default_missing_offsets(
        self,
        default_start: int | None,
        default_end: int | None,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=default_start,
            default_modifier_end=default_end,
        )

        with pytest.raises(
            InvalidDeclarationExport,
            match="default modifier offsets",
        ):
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    remove=True,
                    default_only=True,
                )
            )

    def test_remove_export(self) -> None:
        source = "export class UserService {}"

        declaration = make_declaration(
            exported=True,
            default=False,
            export_modifier_start=0,
            export_modifier_end=6,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                remove=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape
            .REMOVE_EXPORT
        )
        assert plan.edits[0].start == 0
        assert plan.edits[0].end == 7

    @pytest.mark.parametrize(
        (
            "export_start",
            "export_end",
        ),
        (
            (None, 6),
            (0, None),
        ),
    )
    def test_remove_export_missing_offsets(
        self,
        export_start: int | None,
        export_end: int | None,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            export_modifier_start=export_start,
            export_modifier_end=export_end,
        )

        with pytest.raises(
            InvalidDeclarationExport,
            match="export modifier offsets",
        ):
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    remove=True,
                )
            )

    def test_remove_export_default(self) -> None:
        source = (
            "export default class UserService {}"
        )

        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=7,
            default_modifier_end=14,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                remove=True,
            )
        )

        assert plan is not None
        assert plan.shape == (
            DeclarationExportShape
            .REMOVE_EXPORT_DEFAULT
        )
        assert plan.edits[0].start == 0
        assert plan.edits[0].end == 15

    @pytest.mark.parametrize(
        (
            "default_start",
            "default_end",
        ),
        (
            (None, 14),
            (7, None),
        ),
    )
    def test_remove_export_default_missing_offsets(
        self,
        default_start: int | None,
        default_end: int | None,
    ) -> None:
        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=default_start,
            default_modifier_end=default_end,
        )

        with pytest.raises(
            InvalidDeclarationExport,
            match="default modifier offsets",
        ):
            DeclarationExportPlanner().plan(
                make_context(
                    declaration=declaration,
                    remove=True,
                )
            )

    def test_remove_export_default_with_tabs(
        self,
    ) -> None:
        source = (
            "export default\tclass UserService {}"
        )

        declaration = make_declaration(
            exported=True,
            default=True,
            export_modifier_start=0,
            export_modifier_end=6,
            default_modifier_start=7,
            default_modifier_end=14,
        )

        plan = DeclarationExportPlanner().plan(
            make_context(
                source=source,
                declaration=declaration,
                remove=True,
            )
        )

        assert plan is not None
        assert plan.edits[0].end == 15
