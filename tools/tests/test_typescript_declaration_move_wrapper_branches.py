from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from tools.modifier.declaration_move import (
    DeclarationMoveError,
)
from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = (
        "function first(): void {}\n\n"
        "function second(): void {}\n"
    ),
) -> TypeScriptFile:
    path = workspace / "declaration-move.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestMoveDeclarationValidationBranches:
    @pytest.mark.parametrize(
        (
            "name",
            "kwargs",
            "expected_exception",
        ),
        (
            (
                123,
                {"position": "top"},
                TypeError,
            ),
            (
                "",
                {"position": "top"},
                ValueError,
            ),
            (
                "   ",
                {"position": "top"},
                ValueError,
            ),
            (
                "first",
                {"before": 123},
                TypeError,
            ),
            (
                "first",
                {"before": ""},
                ValueError,
            ),
            (
                "first",
                {"before": "   "},
                ValueError,
            ),
            (
                "first",
                {"after": 123},
                TypeError,
            ),
            (
                "first",
                {"after": ""},
                ValueError,
            ),
            (
                "first",
                {"after": "   "},
                ValueError,
            ),
            (
                "first",
                {"position": 123},
                TypeError,
            ),
            (
                "first",
                {"position": ""},
                ValueError,
            ),
            (
                "first",
                {"position": "   "},
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        name,
        kwargs,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        with pytest.raises(
            expected_exception
        ):
            file.move_declaration(
                name,
                **kwargs,
            )


class TestMoveDeclarationLookupBranches:
    def test_missing_declaration_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert (
            file.move_declaration(
                "missing",
                position="top",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_multiple_matching_declarations_rejected(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                "const first = 1, second = 2;\n\n"
                "function second(): void {}\n"
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="More than one declaration",
        ):
            file.move_declaration(
                "second",
                position="top",
            )


class TestMoveDeclarationInternalBranches:
    def test_planner_error_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()
        planner.plan.side_effect = (
            DeclarationMoveError(
                "planner rejected movement"
            )
        )

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationMovePlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="planner rejected movement",
        ):
            file.move_declaration(
                "second",
                position="top",
            )

    def test_none_plan_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        planner = Mock()
        planner.plan.return_value = None

        monkeypatch.setattr(
            "tools.modifier.typescript."
            "DeclarationMovePlanner",
            lambda: planner,
        )

        assert (
            file.move_declaration(
                "second",
                position="top",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_editor_unchanged_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda *_args, **_kwargs: editor,
        )

        assert (
            file.move_declaration(
                "second",
                position="top",
            )
            is False
        )

        assert editor.replace.called
        assert file.operations == []
        assert file.dirty is False


class TestMoveDeclarationSuccessfulOperation:
    def test_operation_metadata(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace
        )

        assert file.move_declaration(
            "second",
            position="top",
        )

        operation = file.operations[-1]

        assert (
            operation["action"]
            == "move_declaration"
        )
        assert operation["name"] == "second"
        assert operation["kind"] == "function"
        assert operation["direction"] == "top"
        assert operation["target"] is None
        assert operation["position"] == "top"
        assert (
            operation["comment_attached"]
            is False
        )
        assert (
            operation["engine"]
            == "typescript_ast"
        )
        assert file.dirty is True
