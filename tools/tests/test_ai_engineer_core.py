from __future__ import annotations

from pathlib import Path

from tools.ai_engineer import (
    AIEngineerMode,
    AIEngineerOperation,
    AIEngineerRequest,
    build_default_ai_engineer,
)
from tools.runtime.bootstrap import (
    build_default_runtime,
)


def write_service(
    root: Path,
) -> Path:
    target = root / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        (
            "export class AppService {\n"
            "  constructor() {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )
    return target


def write_module(
    root: Path,
) -> Path:
    target = root / "src/app.module.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    target.write_text(
        "export class AppModule {}\n",
        encoding="utf-8",
    )
    return target


def connect_request(
    root: Path,
    *,
    mode: str = "plan",
) -> dict:
    return {
        "operation": "connect_service",
        "mode": mode,
        "target_project": str(root),
        "arguments": {
            "target_file": "src/app.service.ts",
            "target_class": "AppService",
            "dependency_name": "config",
            "dependency_type": "ConfigService",
            "dependency_import": "@nestjs/config",
        },
    }


def build_engine(
    root: Path,
):
    runtime = build_default_runtime(
        project_root=root,
    )

    return build_default_ai_engineer(
        runtime=runtime,
    )


def test_request_from_mapping():
    request = AIEngineerRequest.from_mapping(
        {
            "operation": "connect_service",
            "mode": "preview",
            "target_project": ".",
            "arguments": {
                "target_file": "src/app.service.ts",
                "target_class": "AppService",
                "dependency_name": "config",
                "dependency_type": "ConfigService",
                "dependency_import": "@nestjs/config",
            },
        }
    )

    assert (
        request.operation
        == AIEngineerOperation.CONNECT_SERVICE
    )
    assert (
        request.mode
        == AIEngineerMode.PREVIEW
    )
    assert (
        request.argument("dependency_name")
        == "config"
    )


def test_plan_connect_service(
    tmp_path,
):
    write_service(tmp_path)

    result = build_engine(
        tmp_path
    ).handle(
        connect_request(tmp_path)
    )

    assert result.success
    assert result.planned
    assert not result.executed
    assert result.planner_result is not None

    actions = (
        result.planner_result.plan.actions
    )

    assert len(actions) == 2


def test_preview_does_not_modify_file(
    tmp_path,
):
    target = write_service(tmp_path)
    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        connect_request(
            tmp_path,
            mode="preview",
        )
    )

    assert result.success
    assert result.executed

    after = target.read_text(
        encoding="utf-8",
    )

    assert after == before


def test_apply_modifies_service(
    tmp_path,
):
    target = write_service(tmp_path)

    result = build_engine(
        tmp_path
    ).handle(
        connect_request(
            tmp_path,
            mode="apply",
        )
    )

    assert result.success
    assert result.executed

    output = target.read_text(
        encoding="utf-8",
    )

    assert (
        "ConfigService"
        in output
    )
    assert (
        "@nestjs/config"
        in output
    )
    assert (
        "config"
        in output
    )


def test_apply_is_idempotent(
    tmp_path,
):
    target = write_service(tmp_path)
    engine = build_engine(tmp_path)

    first = engine.handle(
        connect_request(
            tmp_path,
            mode="apply",
        )
    )
    second = engine.handle(
        connect_request(
            tmp_path,
            mode="apply",
        )
    )

    assert first.success
    assert second.success

    output = target.read_text(
        encoding="utf-8",
    )

    assert output.count(
        "ConfigService"
    ) >= 1


def test_register_module_plan(
    tmp_path,
):
    write_module(tmp_path)

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": (
                "register_module_import"
            ),
            "mode": "plan",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_file": (
                    "src/app.module.ts"
                ),
                "module_class": (
                    "ConfigModule"
                ),
                "module_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert result.planned
    assert result.planner_result is not None
    assert len(
        result.planner_result.plan.actions
    ) >= 1


def test_invalid_request_returns_error():
    result = (
        build_default_ai_engineer()
        .handle(
            {
                "operation": (
                    "connect_service"
                ),
                "arguments": {},
            }
        )
    )

    assert not result.success
    assert result.error is not None
    assert (
        "Missing or invalid arguments"
        in result.error
    )


def test_target_escape_is_rejected():
    result = (
        build_default_ai_engineer()
        .handle(
            {
                "operation": (
                    "connect_service"
                ),
                "arguments": {
                    "target_file": (
                        "../outside.ts"
                    ),
                    "target_class": (
                        "AppService"
                    ),
                    "dependency_name": (
                        "config"
                    ),
                    "dependency_type": (
                        "ConfigService"
                    ),
                    "dependency_import": (
                        "@nestjs/config"
                    ),
                },
            }
        )
    )

    assert not result.success
    assert result.error is not None
    assert (
        "cannot escape"
        in result.error
    )


def test_target_file_is_resolved_from_class(
    tmp_path,
):
    target = write_service(tmp_path)

    request = {
        "operation": "connect_service",
        "mode": "plan",
        "target_project": str(tmp_path),
        "arguments": {
            "target_class": "AppService",
            "dependency_name": "config",
            "dependency_type": "ConfigService",
            "dependency_import": "@nestjs/config",
        },
    }

    result = build_engine(
        tmp_path
    ).handle(request)

    assert result.success
    assert result.request.arguments[
        "target_file"
    ] == "src/app.service.ts"
    assert target.exists()


def test_missing_class_returns_resolution_error(
    tmp_path,
):
    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "plan",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "MissingService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert not result.success
    assert result.error is not None
    assert "MissingService" in result.error


def test_existing_constructor_dependency_is_noop(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor(\n"
            "    private readonly config: "
            "ConfigService,\n"
            "  ) {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "apply",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "AppService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert result.noop
    assert not result.executed
    assert result.message is not None
    assert (
        "already fully connected"
        in result.message
    )


def test_existing_import_only_adds_constructor_dependency(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor() {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "apply",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "AppService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    # Existing import must not be duplicated.
    assert output.count(
        "from '@nestjs/config'"
    ) == 1

    # Missing constructor dependency must be added.
    assert (
        "private readonly config: "
        "ConfigService"
        in output
    )


def test_existing_import_preview_changes_nothing(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor() {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "preview",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "AppService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert not result.noop

    assert target.read_text(
        encoding="utf-8",
    ) == before


def test_existing_constructor_dependency_only_adds_import(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "export class AppService {\n"
            "  constructor(\n"
            "    private readonly config: "
            "ConfigService,\n"
            "  ) {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "apply",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "AppService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert (
        "import { ConfigService } "
        "from '@nestjs/config';"
        in output
    )

    assert output.count(
        "private readonly config: "
        "ConfigService"
    ) == 1


def test_fully_connected_dependency_is_noop(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor(\n"
            "    private readonly config: "
            "ConfigService,\n"
            "  ) {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        {
            "operation": "connect_service",
            "mode": "apply",
            "target_project": str(
                tmp_path
            ),
            "arguments": {
                "target_class": (
                    "AppService"
                ),
                "dependency_name": (
                    "config"
                ),
                "dependency_type": (
                    "ConfigService"
                ),
                "dependency_import": (
                    "@nestjs/config"
                ),
            },
        }
    )

    assert result.success
    assert result.noop
    assert not result.executed

    assert target.read_text(
        encoding="utf-8",
    ) == before


def write_nest_module(
    root: Path,
    *,
    include_typescript_import: bool,
    include_metadata_import: bool,
) -> Path:
    target = root / "src/app.module.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    lines = [
        "import { Module } "
        "from '@nestjs/common';\n",
    ]

    if include_typescript_import:
        lines.append(
            "import { ConfigModule } "
            "from '@nestjs/config';\n"
        )

    lines.extend(
        [
            "\n",
            "@Module({\n",
            (
                "  imports: [ConfigModule],\n"
                if include_metadata_import
                else "  imports: [],\n"
            ),
            "})\n",
            "export class AppModule {}\n",
        ]
    )

    target.write_text(
        "".join(lines),
        encoding="utf-8",
    )

    return target


def register_module_request(
    root: Path,
    *,
    mode: str = "apply",
) -> dict:
    return {
        "operation": (
            "register_module_import"
        ),
        "mode": mode,
        "target_project": str(root),
        "arguments": {
            "target_class": "AppModule",
            "module_class": "ConfigModule",
            "module_import": "@nestjs/config",
        },
    }


def test_module_registration_fully_complete_is_noop(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=True,
        include_metadata_import=True,
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(tmp_path)
    )

    assert result.success
    assert result.noop
    assert not result.executed
    assert result.message is not None
    assert "already registered" in result.message

    assert target.read_text(
        encoding="utf-8",
    ) == before


def test_existing_module_import_only_adds_metadata(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=True,
        include_metadata_import=False,
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(tmp_path)
    )

    assert result.success
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert output.count(
        "from '@nestjs/config'"
    ) == 1

    assert "imports: [ConfigModule]" in (
        output.replace("\n", " ")
    )


def test_existing_metadata_only_adds_typescript_import(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=False,
        include_metadata_import=True,
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(tmp_path)
    )

    assert result.success
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert (
        "import { ConfigModule } "
        "from '@nestjs/config';"
        in output
    )

    assert output.count(
        "ConfigModule"
    ) >= 2


def test_missing_module_registration_adds_both(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=False,
        include_metadata_import=False,
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(tmp_path)
    )

    assert result.success
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert (
        "import { ConfigModule } "
        "from '@nestjs/config';"
        in output
    )

    assert "imports: [ConfigModule]" in (
        output.replace("\n", " ")
    )


def test_module_registration_preview_changes_nothing(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=False,
        include_metadata_import=False,
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(
            tmp_path,
            mode="preview",
        )
    )

    assert result.success
    assert result.executed
    assert not result.noop

    assert target.read_text(
        encoding="utf-8",
    ) == before

    runtime_result = (
        result.planner_result.runtime_result
    )

    assert runtime_result is not None
    assert runtime_result.dry_run

    assert all(
        not record.saved
        for record
        in runtime_result.records
    )


def test_module_registration_is_idempotent(
    tmp_path,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=False,
        include_metadata_import=False,
    )

    engine = build_engine(tmp_path)

    first = engine.handle(
        register_module_request(tmp_path)
    )

    assert first.success

    after_first = target.read_text(
        encoding="utf-8",
    )

    second = engine.handle(
        register_module_request(tmp_path)
    )

    assert second.success
    assert second.noop
    assert not second.executed

    assert target.read_text(
        encoding="utf-8",
    ) == after_first


def test_module_action_failure_rolls_back_import(
    tmp_path,
    monkeypatch,
):
    target = write_nest_module(
        tmp_path,
        include_typescript_import=False,
        include_metadata_import=False,
    )

    before = target.read_text(
        encoding="utf-8",
    )

    from tools.runtime.executors import (
        AddModuleImportExecutor,
    )

    def fail_execute(
        self,
        action,
    ):
        raise RuntimeError(
            "forced module metadata failure"
        )

    monkeypatch.setattr(
        AddModuleImportExecutor,
        "execute",
        fail_execute,
    )

    result = build_engine(
        tmp_path
    ).handle(
        register_module_request(tmp_path)
    )

    assert not result.success
    assert result.executed

    runtime_result = (
        result.planner_result.runtime_result
    )

    assert runtime_result is not None
    assert runtime_result.failed == 1
    assert runtime_result.rolled_back

    assert target.read_text(
        encoding="utf-8",
    ) == before

    assert any(
        "forced module metadata failure"
        in error
        for error
        in runtime_result.errors
    )


def write_controller(
    root: Path,
    *,
    with_dependency: bool = False,
) -> Path:
    target = (
        root
        / "src/users/users.controller.ts"
    )

    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    if with_dependency:
        source = (
            "import { UsersService } "
            "from './users.service';\n"
            "\n"
            "export class UsersController {\n"
            "  constructor(\n"
            "    private readonly usersService: "
            "UsersService,\n"
            "  ) {}\n"
            "}\n"
        )
    else:
        source = (
            "export class UsersController {\n"
            "  constructor() {}\n"
            "}\n"
        )

    target.write_text(
        source,
        encoding="utf-8",
    )

    return target


def connect_controller_request(
    root: Path,
    *,
    mode: str = "apply",
) -> dict:
    return {
        "operation": "connect_controller",
        "mode": mode,
        "target_project": str(root),
        "arguments": {
            "target_class": (
                "UsersController"
            ),
            "dependency_name": (
                "usersService"
            ),
            "dependency_type": (
                "UsersService"
            ),
            "dependency_import": (
                "./users.service"
            ),
        },
    }


def test_connect_controller_plan(
    tmp_path,
):
    write_controller(tmp_path)

    result = build_engine(
        tmp_path
    ).handle(
        connect_controller_request(
            tmp_path,
            mode="plan",
        )
    )

    assert result.success
    assert result.planned
    assert not result.executed
    assert result.request.arguments[
        "target_file"
    ] == (
        "src/users/users.controller.ts"
    )

    assert result.planner_result is not None
    assert len(
        result.planner_result.plan.actions
    ) == 2


def test_connect_controller_apply(
    tmp_path,
):
    target = write_controller(tmp_path)

    result = build_engine(
        tmp_path
    ).handle(
        connect_controller_request(
            tmp_path
        )
    )

    assert result.success
    assert result.executed
    assert not result.noop

    output = target.read_text(
        encoding="utf-8",
    )

    assert (
        "import { UsersService } "
        "from './users.service';"
        in output
    )

    assert (
        "private readonly usersService: "
        "UsersService"
        in output
    )


def test_connect_controller_preview(
    tmp_path,
):
    target = write_controller(tmp_path)

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        connect_controller_request(
            tmp_path,
            mode="preview",
        )
    )

    assert result.success
    assert result.executed

    assert target.read_text(
        encoding="utf-8",
    ) == before

    runtime = (
        result.planner_result.runtime_result
    )

    assert runtime is not None
    assert runtime.dry_run


def test_connect_controller_complete_is_noop(
    tmp_path,
):
    target = write_controller(
        tmp_path,
        with_dependency=True,
    )

    before = target.read_text(
        encoding="utf-8",
    )

    result = build_engine(
        tmp_path
    ).handle(
        connect_controller_request(
            tmp_path
        )
    )

    assert result.success
    assert result.noop
    assert not result.executed

    assert target.read_text(
        encoding="utf-8",
    ) == before


def test_connect_controller_is_idempotent(
    tmp_path,
):
    target = write_controller(tmp_path)
    engine = build_engine(tmp_path)

    first = engine.handle(
        connect_controller_request(
            tmp_path
        )
    )

    assert first.success

    after_first = target.read_text(
        encoding="utf-8",
    )

    second = engine.handle(
        connect_controller_request(
            tmp_path
        )
    )

    assert second.success
    assert second.noop

    assert target.read_text(
        encoding="utf-8",
    ) == after_first
