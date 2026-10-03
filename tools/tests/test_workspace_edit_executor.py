from __future__ import annotations

from tools.ir.action import (
    WorkspaceEdit,
    WorkspaceFileEdit,
    WorkspaceTextEdit,
)
from tools.ir.plan import ExecutionPlan
from tools.runtime import build_default_runtime


def write_source(
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


def make_action():
    return WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/service.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=13,
                        end=25,
                        text=(
                            "AccountsService"
                        ),
                    ),
                    WorkspaceTextEdit(
                        start=37,
                        end=49,
                        text=(
                            "AccountsService"
                        ),
                    ),
                ),
            ),
            WorkspaceFileEdit(
                file_path="src/controller.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=9,
                        end=21,
                        text=(
                            "AccountsService"
                        ),
                    ),
                ),
            ),
        ),
    )


def make_plan(
    tmp_path,
    action,
):
    return ExecutionPlan(
        title="Workspace rename",
        target_project=str(tmp_path),
        actions=[action],
    )


def build_files(tmp_path):
    service = write_source(
        tmp_path,
        "src/service.ts",
        (
            "export class UsersService {\n"
            "  value: UsersService;\n"
            "}\n"
        ),
    )

    controller = write_source(
        tmp_path,
        "src/controller.ts",
        (
            "import { UsersService } "
            "from './service';\n"
        ),
    )

    return service, controller


def test_workspace_edit_apply(
    tmp_path,
):
    service, controller = build_files(
        tmp_path
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(
            tmp_path,
            make_action(),
        )
    )

    assert result.success
    assert result.executed == 1
    assert result.records[0].changed
    assert result.records[0].saved

    assert service.read_text(
        encoding="utf-8",
    ) == (
        "export class AccountsService {\n"
        "  value: AccountsService;\n"
        "}\n"
    )

    assert controller.read_text(
        encoding="utf-8",
    ) == (
        "import { AccountsService } "
        "from './service';\n"
    )


def test_workspace_edit_dry_run(
    tmp_path,
):
    service, controller = build_files(
        tmp_path
    )

    service_before = service.read_text(
        encoding="utf-8",
    )
    controller_before = controller.read_text(
        encoding="utf-8",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(
            tmp_path,
            make_action(),
        ),
        dry_run=True,
    )

    assert result.success
    assert result.dry_run
    assert result.records[0].changed
    assert not result.records[0].saved

    assert service.read_text(
        encoding="utf-8",
    ) == service_before

    assert controller.read_text(
        encoding="utf-8",
    ) == controller_before


def test_workspace_edit_applies_reverse_offsets(
    tmp_path,
):
    target = write_source(
        tmp_path,
        "src/example.ts",
        "OldName + OldName\n",
    )

    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/example.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=0,
                        end=7,
                        text="LongerNewName",
                    ),
                    WorkspaceTextEdit(
                        start=10,
                        end=17,
                        text="LongerNewName",
                    ),
                ),
            ),
        ),
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(
            tmp_path,
            action,
        )
    )

    assert result.success

    assert target.read_text(
        encoding="utf-8",
    ) == (
        "LongerNewName + "
        "LongerNewName\n"
    )


def test_workspace_edit_rejects_stale_range(
    tmp_path,
):
    target = write_source(
        tmp_path,
        "src/example.ts",
        "short\n",
    )

    before = target.read_text(
        encoding="utf-8",
    )

    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/example.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=100,
                        end=110,
                        text="value",
                    ),
                ),
            ),
        ),
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(
            tmp_path,
            action,
        )
    )

    assert not result.success
    assert result.failed == 1

    assert target.read_text(
        encoding="utf-8",
    ) == before

    assert any(
        "exceeds file length"
        in error
        for error in result.errors
    )
