from __future__ import annotations

from pathlib import Path

import pytest

from tools.modifier.workspace import (
    Workspace,
)


class TestWorkspace:
    def test_root_is_resolved(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(
            tmp_path / "."
        )

        assert workspace.root == (
            tmp_path.resolve()
        )

    def test_resolve_relative_path(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(tmp_path)

        result = workspace.resolve(
            "src/app.ts"
        )

        assert result == (
            tmp_path
            / "src"
            / "app.ts"
        ).resolve()

    def test_resolve_absolute_path_inside_root(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(tmp_path)

        path = (
            tmp_path
            / "src"
            / "app.ts"
        ).resolve()

        assert workspace.resolve(path) == path

    def test_resolve_workspace_root(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(tmp_path)

        assert workspace.resolve(".") == (
            tmp_path.resolve()
        )

    def test_path_escape_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(tmp_path)

        outside = (
            tmp_path.parent
            / "outside.ts"
        )

        with pytest.raises(
            ValueError,
            match="escapes workspace root",
        ):
            workspace.resolve(outside)

    def test_relative_parent_escape_rejected(
        self,
        tmp_path: Path,
    ) -> None:
        workspace = Workspace(tmp_path)

        with pytest.raises(
            ValueError,
            match="escapes workspace root",
        ):
            workspace.resolve(
                "../outside.ts"
            )

    def test_typescript_load_called(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        workspace = Workspace(tmp_path)

        target = (
            tmp_path
            / "src"
            / "app.ts"
        )

        captured: dict[str, Path] = {}
        sentinel = object()

        def fake_load(
            path: str | Path,
        ):
            captured["path"] = Path(path)
            return sentinel

        monkeypatch.setattr(
            "tools.modifier.workspace."
            "TypeScriptFile.load",
            fake_load,
        )

        result = workspace.typescript(
            "src/app.ts"
        )

        assert result is sentinel
        assert captured["path"] == (
            target.resolve()
        )

    def test_typescript_escape_rejected_before_load(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        workspace = Workspace(tmp_path)

        called = False

        def fake_load(
            path: str | Path,
        ):
            nonlocal called
            called = True
            return object()

        monkeypatch.setattr(
            "tools.modifier.workspace."
            "TypeScriptFile.load",
            fake_load,
        )

        with pytest.raises(
            ValueError,
            match="escapes workspace root",
        ):
            workspace.typescript(
                "../outside.ts"
            )

        assert called is False
