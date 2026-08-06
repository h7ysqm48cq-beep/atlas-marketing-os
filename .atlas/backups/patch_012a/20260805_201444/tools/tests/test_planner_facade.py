from __future__ import annotations

from tools.ir.action import (
    AddConstructorParameter,
    AddImport,
    AddModuleImport,
)
from tools.ir.plan import PlanStatus
from tools.ir.task import (
    ConnectServiceTask,
    RegisterModuleImportTask,
)
from tools.planner import (
    PlannerError,
    build_default_planner,
)


def test_connect_service_task_builds_valid_plan(
    tmp_path,
):
    target = tmp_path / "app.service.ts"
    target.write_text(
        "export class AppService {}\n",
        encoding="utf-8",
    )

    task = ConnectServiceTask(
        target_file="app.service.ts",
        target_class="AppService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert result.valid
    assert result.success
    assert result.plan.status == PlanStatus.READY
    assert len(result.plan.actions) == 2
    assert isinstance(
        result.plan.actions[0],
        AddImport,
    )
    assert isinstance(
        result.plan.actions[1],
        AddConstructorParameter,
    )
    assert result.plan.metadata[
        "source_task_id"
    ] == task.task_id


def test_register_module_task_builds_valid_plan(
    tmp_path,
):
    target = tmp_path / "app.module.ts"
    target.write_text(
        "export class AppModule {}\n",
        encoding="utf-8",
    )

    task = RegisterModuleImportTask(
        target_file="app.module.ts",
        module_class="NewsModule",
        module_import="./news/news.module",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert result.valid
    assert len(result.plan.actions) == 2
    assert isinstance(
        result.plan.actions[0],
        AddImport,
    )
    assert isinstance(
        result.plan.actions[1],
        AddModuleImport,
    )


def test_missing_target_fails_validation(
    tmp_path,
):
    task = ConnectServiceTask(
        target_file="missing.service.ts",
        target_class="MissingService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    result = build_default_planner().plan_and_validate(
        task,
        target_project=str(tmp_path),
    )

    assert not result.valid
    assert not result.success
    assert result.validation.failed_count == 1


def test_execute_requires_runtime(tmp_path):
    target = tmp_path / "app.service.ts"
    target.write_text(
        "export class AppService {}\n",
        encoding="utf-8",
    )

    task = ConnectServiceTask(
        target_file="app.service.ts",
        target_class="AppService",
        dependency_name="config",
        dependency_type="ConfigService",
        dependency_import="@nestjs/config",
    )

    planner = build_default_planner()

    try:
        planner.execute(
            task,
            target_project=str(tmp_path),
        )
    except PlannerError as error:
        assert "runtime is not configured" in str(
            error
        )
    else:
        raise AssertionError(
            "PlannerError was not raised"
        )
