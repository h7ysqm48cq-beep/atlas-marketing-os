from __future__ import annotations

from tools.ir.action import (
    WorkspaceEdit,
    WorkspaceFileEdit,
    WorkspaceTextEdit,
)
from tools.ir.plan import (
    ExecutionPlan,
    PlanStatus,
)
from tools.runtime import build_default_runtime
from tools.runtime.executors import (
    WorkspaceEditExecutor,
)


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


def build_action():
    return WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/first.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=13,
                        end=20,
                        text="NewName",
                    ),
                ),
            ),
            WorkspaceFileEdit(
                file_path="src/second.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=13,
                        end=20,
                        text="NewName",
                    ),
                ),
            ),
        ),
    )


def build_plan(
    tmp_path,
):
    return ExecutionPlan(
        title=(
            "Workspace transaction test"
        ),
        target_project=str(tmp_path),
        actions=[
            build_action(),
        ],
    )


def test_workspace_edit_failure_rolls_back_all_files(
    tmp_path,
    monkeypatch,
):
    first = write_source(
        tmp_path,
        "src/first.ts",
        "export class OldName {}\n",
    )

    second = write_source(
        tmp_path,
        "src/second.ts",
        "export class OldName {}\n",
    )

    before_first = first.read_text(
        encoding="utf-8",
    )

    before_second = second.read_text(
        encoding="utf-8",
    )

    original_write_text = (
        type(first).write_text
    )

    write_calls = 0

    def fail_on_second_write(
        self,
        data,
        *args,
        **kwargs,
    ):
        nonlocal write_calls

        if self in {
            first,
            second,
        }:
            write_calls += 1

            if write_calls == 2:
                raise RuntimeError(
                    "forced workspace write failure"
                )

        return original_write_text(
            self,
            data,
            *args,
            **kwargs,
        )

    monkeypatch.setattr(
        type(first),
        "write_text",
        fail_on_second_write,
    )

    plan = build_plan(tmp_path)

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        plan,
        rollback_on_failure=True,
    )

    assert not result.success
    assert result.failed == 1
    assert result.rolled_back

    assert (
        plan.status
        == PlanStatus.ROLLED_BACK
    )

    assert first.read_text(
        encoding="utf-8",
    ) == before_first

    assert second.read_text(
        encoding="utf-8",
    ) == before_second

    assert any(
        "forced workspace write failure"
        in error
        for error in result.errors
    )


def test_workspace_edit_success_keeps_all_changes(
    tmp_path,
):
    first = write_source(
        tmp_path,
        "src/first.ts",
        "export class OldName {}\n",
    )

    second = write_source(
        tmp_path,
        "src/second.ts",
        "export class OldName {}\n",
    )

    plan = build_plan(tmp_path)

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(plan)

    assert result.success
    assert not result.rolled_back

    assert first.read_text(
        encoding="utf-8",
    ) == "export class NewName {}\n"

    assert second.read_text(
        encoding="utf-8",
    ) == "export class NewName {}\n"


def test_workspace_edit_dry_run_needs_no_rollback(
    tmp_path,
):
    first = write_source(
        tmp_path,
        "src/first.ts",
        "export class OldName {}\n",
    )

    second = write_source(
        tmp_path,
        "src/second.ts",
        "export class OldName {}\n",
    )

    before_first = first.read_text(
        encoding="utf-8",
    )

    before_second = second.read_text(
        encoding="utf-8",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        build_plan(tmp_path),
        dry_run=True,
    )

    assert result.success
    assert result.dry_run
    assert not result.rolled_back

    assert first.read_text(
        encoding="utf-8",
    ) == before_first

    assert second.read_text(
        encoding="utf-8",
    ) == before_second
