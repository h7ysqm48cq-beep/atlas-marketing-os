from __future__ import annotations

from tools.ai_engineer import (
    build_default_ai_engineer,
)


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


def rename_request(
    tmp_path,
    *,
    mode: str,
    old_name: str = "UsersService",
    new_name: str = "AccountsService",
):
    return {
        "operation": "rename_symbol",
        "mode": mode,
        "target_project": str(tmp_path),
        "arguments": {
            "target_file": "src/example.ts",
            "old_name": old_name,
            "new_name": new_name,
        },
    }


def test_rename_symbol_plan(
    tmp_path,
):
    target = write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="plan",
        )
    )

    assert result.success
    assert result.completed
    assert not result.noop

    assert target.read_text(
        encoding="utf-8",
    ) == before


def test_rename_symbol_preview(
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

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="preview",
        )
    )

    assert result.success
    assert result.completed

    assert target.read_text(
        encoding="utf-8",
    ) == before


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

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="apply",
        )
    )

    assert result.success
    assert result.completed
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert "UsersService" not in output
    assert output.count(
        "AccountsService"
    ) == 3


def test_rename_symbol_missing_is_noop(
    tmp_path,
):
    write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="apply",
            old_name="MissingService",
        )
    )

    assert result.success
    assert result.noop
    assert not result.completed


def test_rename_symbol_identical_is_noop(
    tmp_path,
):
    write_source(
        tmp_path,
        "export class UsersService {}\n",
    )

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="apply",
            old_name="UsersService",
            new_name="UsersService",
        )
    )

    assert result.success
    assert result.noop
    assert not result.completed


def test_rename_symbol_conflict_fails(
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

    result = build_default_ai_engineer().handle(
        rename_request(
            tmp_path,
            mode="apply",
        )
    )

    assert not result.success
    assert result.error is not None
    assert "already exists" in result.error

    assert target.read_text(
        encoding="utf-8",
    ) == before
