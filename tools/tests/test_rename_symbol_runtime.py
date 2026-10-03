from __future__ import annotations

from tools.ir.action import RenameSymbol
from tools.ir.plan import ExecutionPlan
from tools.runtime import build_default_runtime


def write_source(
    tmp_path,
    content: str,
):
    target = tmp_path / "src/example.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        content,
        encoding="utf-8",
    )
    return target


def make_plan(
    tmp_path,
    action: RenameSymbol,
):
    return ExecutionPlan(
        title="Rename TypeScript symbol",
        target_project=str(tmp_path),
        actions=[action],
    )


def test_rename_symbol_apply(
    tmp_path,
):
    target = write_source(
        tmp_path,
        (
            "export class UsersService {\n"
            "  create(): UsersService {\n"
            "    return new UsersService();\n"
            "  }\n"
            "}\n"
        ),
    )

    action = RenameSymbol(
        file_path="src/example.ts",
        old_name="UsersService",
        new_name="AccountsService",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert result.success
    assert result.executed == 1

    output = target.read_text(
        encoding="utf-8",
    )

    assert "UsersService" not in output
    assert output.count(
        "AccountsService"
    ) == 3


def test_rename_symbol_preview(
    tmp_path,
):
    target = write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    before = target.read_text(
        encoding="utf-8",
    )

    action = RenameSymbol(
        file_path="src/example.ts",
        old_name="UsersService",
        new_name="AccountsService",
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

    assert target.read_text(
        encoding="utf-8",
    ) == before

    assert result.records[0].changed
    assert not result.records[0].saved


def test_identical_names_are_skipped(
    tmp_path,
):
    target = write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    action = RenameSymbol(
        file_path="src/example.ts",
        old_name="UsersService",
        new_name="UsersService",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert result.success
    assert result.skipped == 1
    assert result.executed == 0

    assert "UsersService" in target.read_text(
        encoding="utf-8",
    )


def test_missing_symbol_is_noop(
    tmp_path,
):
    write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    action = RenameSymbol(
        file_path="src/example.ts",
        old_name="MissingService",
        new_name="AccountsService",
    )

    result = build_default_runtime(
        project_root=tmp_path,
        show_preview=False,
    ).run(
        make_plan(tmp_path, action)
    )

    assert result.success
    assert result.records[0].changed is False


def test_rename_conflict_is_rejected(
    tmp_path,
):
    target = write_source(
        tmp_path,
        (
            "export class UsersService {}\n"
            "export class AccountsService {}\n"
        ),
    )

    before = target.read_text(
        encoding="utf-8",
    )

    action = RenameSymbol(
        file_path="src/example.ts",
        old_name="UsersService",
        new_name="AccountsService",
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
    ) == before

    assert any(
        "already exists"
        in error
        for error in result.errors
    )
