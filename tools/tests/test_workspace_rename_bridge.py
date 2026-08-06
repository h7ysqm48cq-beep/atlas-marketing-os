from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from tools.modifier.bridge import (
    TypeScriptBridge,
    TypeScriptBridgeError,
    WorkspaceRenameEdit,
    WorkspaceRenameFile,
    WorkspaceRenameResult,
)


def write_file(
    root: Path,
    relative: str,
    content: str,
) -> Path:
    target = root / relative
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        content,
        encoding="utf-8",
    )
    return target


def build_project(
    tmp_path: Path,
) -> Path:
    write_file(
        tmp_path,
        "tsconfig.json",
        json.dumps(
            {
                "compilerOptions": {
                    "target": "ES2022",
                    "module": "commonjs",
                    "moduleResolution": (
                        "node"
                    ),
                    "strict": True,
                },
                "include": [
                    "src/**/*.ts",
                ],
            }
        ),
    )

    write_file(
        tmp_path,
        "src/users/users.service.ts",
        (
            "export class UsersService {\n"
            "  findAll(): UsersService {\n"
            "    return new UsersService();\n"
            "  }\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "src/users/users.controller.ts",
        (
            "import { UsersService } "
            "from './users.service';\n"
            "\n"
            "export class UsersController {\n"
            "  constructor(\n"
            "    private readonly usersService: "
            "UsersService,\n"
            "  ) {}\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "src/users/users.module.ts",
        (
            "import { UsersService } "
            "from './users.service';\n"
            "\n"
            "export const providers = "
            "[UsersService];\n"
        ),
    )

    return tmp_path


def build_bridge(
    project_root: Path,
) -> TypeScriptBridge:
    repository_root = Path.cwd()

    return TypeScriptBridge(
        project_root=project_root,
        parser_path=(
            repository_root
            / "tools/modifier/parser.js"
        ),
        workspace_rename_path=(
            repository_root
            / "tools/modifier/"
            "workspace_rename.js"
        ),
    )


@pytest.mark.skipif(
    shutil.which("node") is None,
    reason="Node.js is not available",
)
def test_workspace_rename_bridge(
    tmp_path,
):
    build_project(tmp_path)

    result = build_bridge(
        tmp_path
    ).workspace_rename(
        "src/users/users.service.ts",
        "UsersService",
        "AccountsService",
    )

    assert isinstance(
        result,
        WorkspaceRenameResult,
    )

    assert result.ok
    assert result.old_name == (
        "UsersService"
    )
    assert result.new_name == (
        "AccountsService"
    )
    assert result.total_files == 3
    assert result.total_locations >= 7

    paths = {
        file.file_path
        for file in result.files
    }

    assert paths == {
        "src/users/users.service.ts",
        "src/users/users.controller.ts",
        "src/users/users.module.ts",
    }

    assert all(
        isinstance(
            file,
            WorkspaceRenameFile,
        )
        for file in result.files
    )

    assert all(
        file.edits
        for file in result.files
    )

    assert all(
        isinstance(
            edit,
            WorkspaceRenameEdit,
        )
        for file in result.files
        for edit in file.edits
    )


@pytest.mark.skipif(
    shutil.which("node") is None,
    reason="Node.js is not available",
)
def test_workspace_rename_missing_symbol(
    tmp_path,
):
    build_project(tmp_path)

    with pytest.raises(
        TypeScriptBridgeError,
    ) as error:
        build_bridge(
            tmp_path
        ).workspace_rename(
            "src/users/users.service.ts",
            "MissingService",
            "AccountsService",
        )

    assert "was not found" in str(
        error.value
    )


def test_workspace_rename_result_to_dict():
    result = WorkspaceRenameResult(
        project_root="/project",
        config_path="/project/tsconfig.json",
        target_file="src/example.ts",
        old_name="OldName",
        new_name="NewName",
        total_locations=1,
        files=(
            WorkspaceRenameFile(
                file_path="src/example.ts",
                edits=(
                    WorkspaceRenameEdit(
                        start=0,
                        end=7,
                        text="NewName",
                    ),
                ),
            ),
        ),
    )

    payload = result.to_dict()

    assert payload["ok"] is True
    assert payload["total_files"] == 1
    assert payload["total_locations"] == 1
    assert payload["files"][0][
        "edits"
    ][0]["text"] == "NewName"
