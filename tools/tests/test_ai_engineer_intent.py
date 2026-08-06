from __future__ import annotations

import pytest

from tools.ai_engineer import (
    IntentAdapterError,
    IntentToRequestAdapter,
    IntentType,
    RuleBasedIntentParser,
)
from tools.ai_engineer.request import (
    AIEngineerMode,
    AIEngineerOperation,
)
from tools.repository import (
    default_repository_cache,
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


def test_parse_english_rename():
    intent = RuleBasedIntentParser().parse(
        "Rename UsersService "
        "to AccountsService"
    )

    assert intent.intent_type == (
        IntentType.RENAME_SYMBOL
    )

    assert intent.arguments == {
        "old_name": "UsersService",
        "new_name": "AccountsService",
    }

    assert intent.actionable


def test_parse_chinese_rename():
    intent = RuleBasedIntentParser().parse(
        "把 UsersService 改成 "
        "AccountsService"
    )

    assert intent.intent_type == (
        IntentType.RENAME_SYMBOL
    )

    assert intent.arguments[
        "new_name"
    ] == "AccountsService"


def test_parse_english_crud():
    intent = RuleBasedIntentParser().parse(
        "Create users CRUD"
    )

    assert intent.intent_type == (
        IntentType.CREATE_CRUD
    )

    assert intent.arguments[
        "resource_name"
    ] == "users"


def test_parse_chinese_crud():
    intent = RuleBasedIntentParser().parse(
        "帮我创建 products CRUD"
    )

    assert intent.intent_type == (
        IntentType.CREATE_CRUD
    )

    assert intent.arguments[
        "resource_name"
    ] == "products"


def test_parse_ui_redesign_requires_review():
    intent = RuleBasedIntentParser().parse(
        "把 Dashboard 重新设计，"
        "留白多一点，手机版也优化"
    )

    assert intent.intent_type == (
        IntentType.REDESIGN_UI
    )

    assert intent.requires_review
    assert not intent.actionable


def test_parse_investigation_requires_review():
    intent = RuleBasedIntentParser().parse(
        "修复 Facebook Scheduler "
        "没有反应的问题"
    )

    assert intent.intent_type == (
        IntentType.INVESTIGATE_AND_FIX
    )

    assert intent.requires_review


def test_rename_adapter_resolves_file(
    tmp_path,
):
    write_source(
        tmp_path,
        "src/users/users.service.ts",
        "export class UsersService {}\n",
    )

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Rename UsersService "
        "to AccountsService"
    )

    result = (
        IntentToRequestAdapter()
        .adapt(
            intent,
            target_project=str(
                tmp_path
            ),
        )
    )

    assert result.executable
    assert not result.requires_review

    assert result.request is not None

    assert result.request.mode == (
        AIEngineerMode.PLAN
    )

    assert result.request.operation == (
        AIEngineerOperation.RENAME_SYMBOL
    )

    assert result.request.arguments[
        "target_file"
    ] == (
        "src/users/users.service.ts"
    )


def test_crud_adapter_defaults_to_plan(
    tmp_path,
):
    intent = RuleBasedIntentParser().parse(
        "Create orders CRUD"
    )

    result = (
        IntentToRequestAdapter()
        .adapt(
            intent,
            target_project=str(
                tmp_path
            ),
        )
    )

    assert result.request is not None

    assert result.request.mode == (
        AIEngineerMode.PLAN
    )

    assert result.request.operation == (
        AIEngineerOperation.CREATE_CRUD
    )


def test_apply_is_blocked_without_permission(
    tmp_path,
):
    intent = RuleBasedIntentParser().parse(
        "Create orders CRUD"
    )

    with pytest.raises(
        IntentAdapterError,
    ) as error:
        IntentToRequestAdapter().adapt(
            intent,
            target_project=str(
                tmp_path
            ),
            mode=AIEngineerMode.APPLY,
            allow_apply=False,
        )

    assert "not authorized" in str(
        error.value
    )


def test_ui_intent_does_not_create_request(
    tmp_path,
):
    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    result = (
        IntentToRequestAdapter()
        .adapt(
            intent,
            target_project=str(
                tmp_path
            ),
        )
    )

    assert not result.executable
    assert result.request is None
    assert result.requires_review
