from __future__ import annotations

from pathlib import Path
from unittest.mock import Mock

import pytest

from tools.modifier.exceptions import (
    UnsupportedTypeScriptImport,
)
from tools.modifier.export_removal import (
    ExportRemovalAmbiguous,
    ExportRemovalNotFound,
)
from tools.modifier.typescript import (
    TypeScriptFile,
)


def write_typescript(
    workspace: Path,
    source: str = "",
) -> TypeScriptFile:
    path = workspace / "sample.ts"

    path.write_text(
        source,
        encoding="utf-8",
    )

    return TypeScriptFile.load(path)


class TestRemoveExportValidationBranches:
    @pytest.mark.parametrize(
        (
            "symbol",
            "from_module",
            "expected_exception",
        ),
        (
            (
                123,
                None,
                TypeError,
            ),
            (
                "",
                None,
                ValueError,
            ),
            (
                "   ",
                None,
                ValueError,
            ),
            (
                "UserService",
                123,
                TypeError,
            ),
            (
                "UserService",
                "",
                ValueError,
            ),
            (
                "UserService",
                "   ",
                ValueError,
            ),
        ),
    )
    def test_invalid_arguments(
        self,
        temp_workspace: Path,
        symbol,
        from_module,
        expected_exception,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        with pytest.raises(
            expected_exception,
        ):
            file.remove_export(
                symbol,
                from_module,
            )

        assert file.operations == []
        assert file.dirty is False

    def test_missing_export_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        assert (
            file.remove_export(
                "MissingService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_ambiguous_export_is_wrapped(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                'export { UserService } from "./a";\n'
                'export { UserService } from "./b";\n'
            ),
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="ambiguous|more than one|multiple|Multiple",
        ):
            file.remove_export(
                "UserService",
            )

        assert file.operations == []
        assert file.dirty is False


class TestRemoveExportInternalBranches:
    def test_export_removal_not_found_is_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        planner = Mock()
        planner.plan.side_effect = ExportRemovalNotFound(
            "missing"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ExportRemovalPlanner",
            lambda: planner,
        )

        assert (
            file.remove_export(
                "UserService",
            )
            is False
        )

        assert file.operations == []
        assert file.dirty is False

    def test_export_removal_ambiguous_is_wrapped(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        planner = Mock()
        planner.plan.side_effect = ExportRemovalAmbiguous(
            "ambiguous export"
        )

        monkeypatch.setattr(
            "tools.modifier.typescript.ExportRemovalPlanner",
            lambda: planner,
        )

        with pytest.raises(
            UnsupportedTypeScriptImport,
            match="ambiguous export",
        ):
            file.remove_export(
                "UserService",
            )

        assert file.operations == []
        assert file.dirty is False

    def test_changed_false_returns_false(
        self,
        temp_workspace: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        plan = Mock()
        plan.start = 0
        plan.end = 0
        plan.text = ""
        plan.shape.value = "named_export"

        planner = Mock()
        planner.plan.return_value = plan

        editor = Mock()
        editor.apply.return_value = False

        monkeypatch.setattr(
            "tools.modifier.typescript.ExportRemovalPlanner",
            lambda: planner,
        )
        monkeypatch.setattr(
            "tools.modifier.typescript.BridgeEditor",
            lambda source, result: editor,
        )

        assert (
            file.remove_export(
                "UserService",
            )
            is False
        )

        editor.replace.assert_called_once_with(
            0,
            0,
            "",
        )

        assert file.operations == []
        assert file.dirty is False

    def test_remove_named_export_logging(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            (
                'export { UserService, AdminService } '
                'from "./services";\n'
            ),
        )

        assert file.remove_export(
            "UserService",
            "./services",
        )

        output = file.source()

        assert "UserService" not in output
        assert "AdminService" in output

        operation = file.operations[-1]

        assert operation["action"] == "remove_export"
        assert operation["symbol"] == "UserService"
        assert operation["module"] == "./services"
        assert operation["engine"] == "typescript_ast"
        assert isinstance(
            operation["shape"],
            str,
        )

        assert file.dirty is True


class TestSaveBranches:
    def test_save_without_changes_returns_false(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "const value = 1;\n",
        )

        assert file.save() is False
        assert file.dirty is False

        assert (
            file.path.read_text(
                encoding="utf-8",
            )
            == "const value = 1;\n"
        )

    def test_save_with_changes_writes_file(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            "const value = 1;\n",
        )

        file._current_text = "const value = 2;\n"
        file.dirty = True

        assert file.save() is True

        assert (
            file.path.read_text(
                encoding="utf-8",
            )
            == "const value = 2;\n"
        )

        assert file.source() == "const value = 2;\n"
        assert file.dirty is False
        assert file._original_text == "const value = 2;\n"

    def test_save_after_ast_change(
        self,
        temp_workspace: Path,
    ) -> None:
        file = write_typescript(
            temp_workspace,
            'export { UserService } from "./user";\n',
        )

        assert file.remove_export(
            "UserService",
            "./user",
        )

        assert file.dirty is True
        assert file.save() is True
        assert file.dirty is False

        saved = file.path.read_text(
            encoding="utf-8",
        )

        assert "UserService" not in saved
