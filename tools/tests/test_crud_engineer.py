from __future__ import annotations

from tools.ai_engineer import (
    build_default_ai_engineer,
)


def crud_request(
    tmp_path,
    *,
    mode: str,
) -> dict:
    return {
        "operation": "create_crud",
        "mode": mode,
        "target_project": str(tmp_path),
        "arguments": {
            "resource_name": "users",
        },
    }


def test_create_crud_preview(
    tmp_path,
):
    result = build_default_ai_engineer().handle(
        crud_request(
            tmp_path,
            mode="preview",
        )
    )

    assert result.success
    assert result.completed
    assert not result.noop

    assert not (
        tmp_path
        / "src/users/users.service.ts"
    ).exists()

    assert not (
        tmp_path
        / "src/users/users.controller.ts"
    ).exists()

    assert not (
        tmp_path
        / "src/users/users.module.ts"
    ).exists()


def test_create_crud_apply(
    tmp_path,
):
    result = build_default_ai_engineer().handle(
        crud_request(
            tmp_path,
            mode="apply",
        )
    )

    assert result.success
    assert result.completed
    assert not result.noop

    service = (
        tmp_path
        / "src/users/users.service.ts"
    )
    controller = (
        tmp_path
        / "src/users/users.controller.ts"
    )
    module = (
        tmp_path
        / "src/users/users.module.ts"
    )

    assert service.exists()
    assert controller.exists()
    assert module.exists()

    assert "UsersService" in service.read_text(
        encoding="utf-8",
    )
    assert "UsersController" in controller.read_text(
        encoding="utf-8",
    )
    assert "UsersModule" in module.read_text(
        encoding="utf-8",
    )


def test_create_crud_is_idempotent(
    tmp_path,
):
    engineer = build_default_ai_engineer()

    first = engineer.handle(
        crud_request(
            tmp_path,
            mode="apply",
        )
    )
    second = engineer.handle(
        crud_request(
            tmp_path,
            mode="apply",
        )
    )

    assert first.success
    assert first.completed

    assert second.success
    assert second.noop
    assert not second.completed


def test_existing_conflicting_file_is_rejected(
    tmp_path,
):
    target = (
        tmp_path
        / "src/users/users.service.ts"
    )
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        "custom content\n",
        encoding="utf-8",
    )

    result = build_default_ai_engineer().handle(
        crud_request(
            tmp_path,
            mode="apply",
        )
    )

    assert not result.success
    assert result.error is not None
    assert "Refusing to overwrite" in result.error


def test_create_crud_plan_changes_nothing(
    tmp_path,
):
    result = build_default_ai_engineer().handle(
        crud_request(
            tmp_path,
            mode="plan",
        )
    )

    assert result.success
    assert result.completed

    assert not (
        tmp_path / "src/users"
    ).exists()


def test_create_crud_failure_rolls_back_all_files(
    tmp_path,
    monkeypatch,
):
    from tools.runtime.executors import (
        CreateFileExecutor,
    )

    original_execute = (
        CreateFileExecutor.execute
    )

    def fail_on_second_file(
        self,
        action,
    ):
        count = getattr(
            self,
            "_crud_test_calls",
            0,
        ) + 1

        self._crud_test_calls = count

        if count == 2:
            raise RuntimeError(
                "forced CRUD file failure"
            )

        return original_execute(
            self,
            action,
        )

    monkeypatch.setattr(
        CreateFileExecutor,
        "execute",
        fail_on_second_file,
    )

    result = build_default_ai_engineer().handle(
        crud_request(
            tmp_path,
            mode="apply",
        )
    )

    assert not result.success
    assert result.error is not None
    assert (
        "forced CRUD file failure"
        in result.error
    )

    assert not (
        tmp_path
        / "src/users/users.service.ts"
    ).exists()

    assert not (
        tmp_path
        / "src/users/users.controller.ts"
    ).exists()

    assert not (
        tmp_path
        / "src/users/users.module.ts"
    ).exists()
