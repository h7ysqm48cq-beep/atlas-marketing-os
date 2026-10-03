from __future__ import annotations

import pytest

from tools.ir.action import RenameSymbol
from tools.planner import (
    RepositoryRenamePlanner,
)
from tools.repository import (
    AtlasProject,
    SymbolAmbiguous,
    SymbolNotFound,
)


def write_file(
    root,
    relative: str,
    content: str,
):
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


def build_project(tmp_path):
    write_file(
        tmp_path,
        "src/users/users.service.ts",
        (
            "export class UsersService {\n"
            "  findAll() {\n"
            "    return [];\n"
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

    write_file(
        tmp_path,
        "src/unrelated.ts",
        (
            "export class "
            "UnrelatedService {}\n"
        ),
    )

    return AtlasProject.load(
        tmp_path
    )


def test_repository_rename_builds_stable_plan(
    tmp_path,
):
    project = build_project(tmp_path)

    result = RepositoryRenamePlanner(
        project
    ).plan(
        "UsersService",
        "AccountsService",
    )

    assert result.declaration_file == (
        "src/users/users.service.ts"
    )

    assert [
        target.file_path
        for target in result.targets
    ] == [
        "src/users/users.service.ts",
        "src/users/users.controller.ts",
        "src/users/users.module.ts",
    ]

    assert result.targets[0].declaration
    assert all(
        not target.declaration
        for target in result.targets[1:]
    )

    actions = (
        result.execution_plan.actions
    )

    assert len(actions) == 3

    assert all(
        isinstance(
            action,
            RenameSymbol,
        )
        for action in actions
    )

    assert [
        action.file_path
        for action in actions
    ] == [
        "src/users/users.service.ts",
        "src/users/users.controller.ts",
        "src/users/users.module.ts",
    ]


def test_repository_rename_deduplicates_files(
    tmp_path,
):
    project = build_project(tmp_path)

    result = RepositoryRenamePlanner(
        project
    ).plan(
        "UsersService",
        "AccountsService",
    )

    paths = [
        target.file_path
        for target in result.targets
    ]

    assert len(paths) == len(set(paths))


def test_repository_rename_ignores_unrelated_files(
    tmp_path,
):
    project = build_project(tmp_path)

    result = RepositoryRenamePlanner(
        project
    ).plan(
        "UsersService",
        "AccountsService",
    )

    paths = {
        target.file_path
        for target in result.targets
    }

    assert (
        "src/unrelated.ts"
        not in paths
    )


def test_repository_rename_missing_symbol_fails(
    tmp_path,
):
    project = build_project(tmp_path)

    with pytest.raises(SymbolNotFound):
        RepositoryRenamePlanner(
            project
        ).plan(
            "MissingService",
            "AccountsService",
        )


def test_repository_rename_ambiguous_symbol_fails(
    tmp_path,
):
    write_file(
        tmp_path,
        "src/one.ts",
        "export class UsersService {}\n",
    )

    write_file(
        tmp_path,
        "src/two.ts",
        "export class UsersService {}\n",
    )

    project = AtlasProject.load(
        tmp_path
    )

    with pytest.raises(SymbolAmbiguous):
        RepositoryRenamePlanner(
            project
        ).plan(
            "UsersService",
            "AccountsService",
        )
