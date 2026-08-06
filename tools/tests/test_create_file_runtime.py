from __future__ import annotations

from tools.ir.action import CreateFile
from tools.ir.plan import (
    ExecutionPlan,
    PlanStatus,
)
from tools.runtime import (
    build_default_runtime,
)


def make_plan(
    tmp_path,
    *actions: CreateFile,
) -> ExecutionPlan:
    return ExecutionPlan(
        title="Create source files",
        target_project=str(tmp_path),
        actions=list(actions),
    )


def test_create_file_apply(
    tmp_path,
):
    action = CreateFile(
        file_path="src/example.ts",
        content="export const value = 1;\n",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    target = tmp_path / "src/example.ts"

    assert result.success
    assert result.executed == 1
    assert target.read_text(
        encoding="utf-8",
    ) == "export const value = 1;\n"


def test_create_file_dry_run(
    tmp_path,
):
    action = CreateFile(
        file_path="src/example.ts",
        content="export const value = 1;\n",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action),
        dry_run=True,
    )

    assert result.success
    assert result.dry_run
    assert not (
        tmp_path / "src/example.ts"
    ).exists()


def test_identical_existing_file_is_idempotent(
    tmp_path,
):
    target = tmp_path / "src/example.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        "export const value = 1;\n",
        encoding="utf-8",
    )

    action = CreateFile(
        file_path="src/example.ts",
        content="export const value = 1;\n",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert result.success
    assert result.records[0].changed is False


def test_conflicting_file_is_rejected(
    tmp_path,
):
    target = tmp_path / "src/example.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        "custom content\n",
        encoding="utf-8",
    )

    action = CreateFile(
        file_path="src/example.ts",
        content="generated content\n",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert not result.success
    assert result.failed == 1

    assert target.read_text(
        encoding="utf-8",
    ) == "custom content\n"


def test_failure_removes_previously_created_file(
    tmp_path,
):
    conflict = tmp_path / "src/second.ts"
    conflict.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    conflict.write_text(
        "custom content\n",
        encoding="utf-8",
    )

    first = CreateFile(
        file_path="src/first.ts",
        content="first\n",
    )
    second = CreateFile(
        file_path="src/second.ts",
        content="generated second\n",
    )

    plan = make_plan(
        tmp_path,
        first,
        second,
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(plan)

    assert not result.success
    assert result.rolled_back
    assert plan.status == PlanStatus.ROLLED_BACK

    assert not (
        tmp_path / "src/first.ts"
    ).exists()

    assert conflict.read_text(
        encoding="utf-8",
    ) == "custom content\n"


def test_create_file_rejects_empty_content(
    tmp_path,
):
    action = CreateFile(
        file_path="src/empty.ts",
        content="",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert not result.success
    assert result.executed == 0
    assert result.failed == 1
    assert any(
        "non-empty string content"
        in error
        for error in result.errors
    )


def test_create_file_rejects_path_escape(
    tmp_path,
):
    action = CreateFile(
        file_path="../outside.ts",
        content="outside\n",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert not result.success
    assert result.executed == 0
    assert result.failed == 1
    assert any(
        "escapes project root"
        in error
        for error in result.errors
    )
