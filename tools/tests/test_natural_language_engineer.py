from __future__ import annotations

from tools.ai_engineer import (
    IntentType,
    build_natural_language_engineer,
)
from tools.ai_engineer.request import (
    AIEngineerMode,
)
from tools.repository import (
    default_repository_cache,
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
    write_file(
        tmp_path,
        "src/users/users.service.ts",
        "export class UsersService {}\n",
    )

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "DashboardOverview.tsx",
        (
            "export function "
            "DashboardOverview() {\n"
            "  return null;\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "DashboardOverview.module.css",
        ".dashboard {}\n",
    )

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "AppLayout.tsx",
        (
            "export function AppLayout() {\n"
            "  return null;\n"
            "}\n"
        ),
    )


def test_natural_language_rename_builds_plan(
    tmp_path,
):
    build_repository(tmp_path)
    default_repository_cache.clear()

    result = (
        build_natural_language_engineer()
        .handle(
            "把 UsersService 改成 "
            "AccountsService",
            target_project=str(
                tmp_path
            ),
        )
    )

    assert result.success
    assert result.intent.intent_type == (
        IntentType.RENAME_SYMBOL
    )

    assert result.engineer_result is not None
    assert not result.executed

    target = (
        tmp_path
        / "src/users/users.service.ts"
    )

    assert "UsersService" in (
        target.read_text(
            encoding="utf-8",
        )
    )


def test_natural_language_crud_defaults_to_plan(
    tmp_path,
):
    result = (
        build_natural_language_engineer()
        .handle(
            "创建 orders CRUD",
            target_project=str(
                tmp_path
            ),
        )
    )

    assert result.success
    assert result.engineer_result is not None
    assert not result.executed

    assert not (
        tmp_path / "src/orders"
    ).exists()


def test_ui_request_returns_reasoning_plan(
    tmp_path,
):
    build_repository(tmp_path)
    default_repository_cache.clear()

    result = (
        build_natural_language_engineer()
        .handle(
            "把 Dashboard 重新设计，"
            "留白多一点，手机版也优化",
            target_project=str(
                tmp_path
            ),
        )
    )

    assert result.success
    assert result.engineering_plan is not None
    assert result.engineer_result is None
    assert result.requires_review
    assert not result.executed

    paths = {
        item.file_path
        for item
        in result.engineering_plan
        .related_files
    }

    assert (
        "apps/web/src/components/"
        "DashboardOverview.tsx"
        in paths
    )


def test_apply_is_blocked_by_default(
    tmp_path,
):
    result = (
        build_natural_language_engineer()
        .handle(
            "创建 orders CRUD",
            target_project=str(
                tmp_path
            ),
            mode=AIEngineerMode.APPLY,
            allow_apply=False,
        )
    )

    assert not result.success
    assert result.error is not None
    assert "not authorized" in (
        result.error
    )

    assert not (
        tmp_path / "src/orders"
    ).exists()


def test_authorized_apply_can_execute(
    tmp_path,
):
    result = (
        build_natural_language_engineer()
        .handle(
            "创建 orders CRUD",
            target_project=str(
                tmp_path
            ),
            mode=AIEngineerMode.APPLY,
            allow_apply=True,
        )
    )

    assert result.success

    assert (
        tmp_path
        / "src/orders/orders.service.ts"
    ).exists()
