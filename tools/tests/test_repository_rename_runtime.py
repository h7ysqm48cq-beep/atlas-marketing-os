from __future__ import annotations

from tools.planner import (
    RepositoryRenamePlanner,
)
from tools.repository import AtlasProject
from tools.runtime import build_default_runtime
from tools.runtime.executors import (
    RenameSymbolExecutor,
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


def build_repository(tmp_path):
    service = write_file(
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

    controller = write_file(
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
            "\n"
            "  getService(): UsersService {\n"
            "    return this.usersService;\n"
            "  }\n"
            "}\n"
        ),
    )

    module = write_file(
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

    unrelated = write_file(
        tmp_path,
        "src/unrelated.ts",
        (
            "export class "
            "UnrelatedService {}\n"
        ),
    )

    return {
        "service": service,
        "controller": controller,
        "module": module,
        "unrelated": unrelated,
    }


def build_plan(tmp_path):
    project = AtlasProject.load(
        tmp_path
    )

    return RepositoryRenamePlanner(
        project
    ).plan(
        "UsersService",
        "AccountsService",
    ).execution_plan


def test_repository_rename_apply(
    tmp_path,
):
    files = build_repository(tmp_path)

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        build_plan(tmp_path)
    )

    assert result.success
    assert result.executed == 3
    assert result.failed == 0
    assert not result.rolled_back

    service_output = files[
        "service"
    ].read_text(
        encoding="utf-8",
    )

    controller_output = files[
        "controller"
    ].read_text(
        encoding="utf-8",
    )

    module_output = files[
        "module"
    ].read_text(
        encoding="utf-8",
    )

    unrelated_output = files[
        "unrelated"
    ].read_text(
        encoding="utf-8",
    )

    assert "UsersService" not in (
        service_output
    )
    assert "UsersService" not in (
        controller_output
    )
    assert "UsersService" not in (
        module_output
    )

    assert service_output.count(
        "AccountsService"
    ) == 3

    assert controller_output.count(
        "AccountsService"
    ) == 3

    assert module_output.count(
        "AccountsService"
    ) == 2

    assert unrelated_output == (
        "export class "
        "UnrelatedService {}\n"
    )


def test_repository_rename_preview_changes_nothing(
    tmp_path,
):
    files = build_repository(tmp_path)

    before = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        build_plan(tmp_path),
        dry_run=True,
    )

    assert result.success
    assert result.dry_run
    assert result.executed == 3

    assert all(
        record.changed
        for record in result.records
    )

    assert all(
        not record.saved
        for record in result.records
    )

    after = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    assert after == before


def test_repository_rename_is_idempotent(
    tmp_path,
):
    files = build_repository(tmp_path)

    first_plan = build_plan(
        tmp_path
    )

    first = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(first_plan)

    assert first.success

    after_first = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    project = AtlasProject.load(
        tmp_path
    )

    second_plan = (
        RepositoryRenamePlanner(
            project
        ).plan(
            "AccountsService",
            "AccountsService",
        ).execution_plan
    )

    second = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(second_plan)

    assert second.success
    assert second.executed == 0
    assert second.skipped >= 1

    after_second = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    assert after_second == after_first


def test_repository_rename_failure_rolls_back_all(
    tmp_path,
    monkeypatch,
):
    files = build_repository(tmp_path)

    before = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    original_execute = (
        RenameSymbolExecutor.execute
    )

    def fail_on_second_file(
        self,
        action,
    ):
        call_count = getattr(
            self,
            "_repository_rename_calls",
            0,
        ) + 1

        self._repository_rename_calls = (
            call_count
        )

        if call_count == 2:
            raise RuntimeError(
                "forced repository rename failure"
            )

        return original_execute(
            self,
            action,
        )

    monkeypatch.setattr(
        RenameSymbolExecutor,
        "execute",
        fail_on_second_file,
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        build_plan(tmp_path)
    )

    assert not result.success
    assert result.failed == 1
    assert result.rolled_back

    assert any(
        "forced repository rename failure"
        in error
        for error in result.errors
    )

    after = {
        name: path.read_text(
            encoding="utf-8",
        )
        for name, path in files.items()
    }

    assert after == before
