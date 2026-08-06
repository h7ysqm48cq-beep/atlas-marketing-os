from __future__ import annotations

from tools.ir.action import (
    WorkspaceEdit,
    WorkspaceFileEdit,
    WorkspaceTextEdit,
)
from tools.ir.basic_validators import (
    register_basic_validators,
)
from tools.ir.plan import ExecutionPlan
from tools.ir.result import (
    ValidationDecision,
)
from tools.ir.validator import (
    ExecutionPlanValidator,
    ValidatorRegistry,
)


def write_source(
    tmp_path,
    relative: str,
    content: str,
):
    target = tmp_path / relative
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        content,
        encoding="utf-8",
    )
    return target


def validate(
    tmp_path,
    action: WorkspaceEdit,
):
    registry = ValidatorRegistry()

    register_basic_validators(
        registry
    )

    plan = ExecutionPlan(
        title="Workspace edit",
        target_project=str(tmp_path),
        actions=[action],
    )

    return ExecutionPlanValidator(
        registry
    ).validate(plan)


def test_workspace_edit_to_dict(
    tmp_path,
):
    write_source(
        tmp_path,
        "src/example.ts",
        "export class OldName {}\n",
    )

    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/example.ts",
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

    payload = action.to_dict()

    assert payload["kind"] == (
        "WorkspaceEdit"
    )

    assert payload["files"][0][
        "file_path"
    ] == "src/example.ts"

    assert payload["files"][0][
        "edits"
    ][0] == {
        "start": 13,
        "end": 20,
        "text": "NewName",
    }


def test_workspace_edit_validation_passes(
    tmp_path,
):
    write_source(
        tmp_path,
        "src/example.ts",
        "export class OldName {}\n",
    )

    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/example.ts",
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

    report = validate(
        tmp_path,
        action,
    )

    assert not report.has_failures
    assert (
        report.results[0].decision
        == ValidationDecision.PASS
    )


def test_workspace_edit_rejects_duplicate_file(
    tmp_path,
):
    write_source(
        tmp_path,
        "src/example.ts",
        "export class OldName {}\n",
    )

    file_edit = WorkspaceFileEdit(
        file_path="src/example.ts",
        edits=(
            WorkspaceTextEdit(
                start=13,
                end=20,
                text="NewName",
            ),
        ),
    )

    action = WorkspaceEdit(
        files=(
            file_edit,
            file_edit,
        ),
    )

    report = validate(
        tmp_path,
        action,
    )

    assert report.has_failures
    assert "duplicate" in (
        report.results[0].message
    )


def test_workspace_edit_rejects_overlap(
    tmp_path,
):
    write_source(
        tmp_path,
        "src/example.ts",
        "export class OldName {}\n",
    )

    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="src/example.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=10,
                        end=20,
                        text="First",
                    ),
                    WorkspaceTextEdit(
                        start=15,
                        end=25,
                        text="Second",
                    ),
                ),
            ),
        ),
    )

    report = validate(
        tmp_path,
        action,
    )

    assert report.has_failures
    assert "overlap" in (
        report.results[0].message
    )


def test_workspace_edit_rejects_path_escape(
    tmp_path,
):
    action = WorkspaceEdit(
        files=(
            WorkspaceFileEdit(
                file_path="../outside.ts",
                edits=(
                    WorkspaceTextEdit(
                        start=0,
                        end=1,
                        text="x",
                    ),
                ),
            ),
        ),
    )

    report = validate(
        tmp_path,
        action,
    )

    assert report.has_failures
    assert "escapes project root" in (
        report.results[0].message
    )
