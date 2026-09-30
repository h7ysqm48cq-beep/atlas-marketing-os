from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from tools.ir.action import RenameSymbol
from tools.ir.plan import ExecutionPlan
from tools.ir.task import (
    ConnectServiceTask,
    RegisterModuleImportTask,
)
from tools.planner import (
    AtlasPlanner,
    build_default_planner,
)
from tools.runtime import (
    build_default_runtime,
)
from tools.repository import (
    RepositoryResolver,
    SymbolNotFound,
    default_repository_cache,
)

from .crud import CRUDGenerator

from .request import (
    AIEngineerMode,
    AIEngineerOperation,
    AIEngineerRequest,
    AIEngineerRequestError,
)
from .result import AIEngineerResult


class AIEngineerError(RuntimeError):
    """Base error raised by Atlas AI Engineer."""


class AtlasAIEngineer:
    """
    Stable facade for Atlas AI code operations.

    Flow:

    Request
        -> Task
        -> Planner
        -> Validation
        -> Optional Runtime execution
        -> AIEngineerResult
    """

    def __init__(
        self,
        *,
        planner: AtlasPlanner,
    ) -> None:
        self.planner = planner

    def handle(
        self,
        request: (
            AIEngineerRequest
            | Mapping[str, Any]
        ),
    ) -> AIEngineerResult:
        try:
            normalized = self._normalize_request(
                request
            )
            if (
                normalized.operation
                == AIEngineerOperation.CREATE_CRUD
            ):
                return self._handle_create_crud(
                    normalized
                )

            if (
                normalized.operation
                == AIEngineerOperation.RENAME_SYMBOL
            ):
                return self._handle_rename_symbol(
                    normalized
                )

            normalized = self._resolve_request(
                normalized
            )

            noop_message = self._detect_noop(
                normalized
            )

            if noop_message is not None:
                return AIEngineerResult(
                    request=normalized,
                    noop=True,
                    message=noop_message,
                )

            task = self._build_task(normalized)

            if normalized.mode == AIEngineerMode.PLAN:
                planner_result = (
                    self.planner.plan_and_validate(
                        task,
                        target_project=(
                            normalized.target_project
                        ),
                    )
                )

            elif (
                normalized.mode
                == AIEngineerMode.PREVIEW
            ):
                planner_result = self.planner.execute(
                    task,
                    target_project=(
                        normalized.target_project
                    ),
                    dry_run=True,
                    rollback_on_failure=True,
                )

            elif (
                normalized.mode
                == AIEngineerMode.APPLY
            ):
                planner_result = self.planner.execute(
                    task,
                    target_project=(
                        normalized.target_project
                    ),
                    dry_run=False,
                    rollback_on_failure=True,
                )

            else:
                raise AIEngineerError(
                    "Unsupported AI Engineer mode"
                )

            return AIEngineerResult(
                request=normalized,
                planner_result=planner_result,
            )

        except (
            AIEngineerRequestError,
            AIEngineerError,
            TypeError,
            ValueError,
        ) as error:
            fallback_request = (
                request
                if isinstance(
                    request,
                    AIEngineerRequest,
                )
                else self._fallback_request(request)
            )

            return AIEngineerResult(
                request=fallback_request,
                error=str(error),
            )

        except Exception as error:
            fallback_request = (
                request
                if isinstance(
                    request,
                    AIEngineerRequest,
                )
                else self._fallback_request(request)
            )

            return AIEngineerResult(
                request=fallback_request,
                error=(
                    f"{type(error).__name__}: "
                    f"{error}"
                ),
            )

    @staticmethod
    def _handle_rename_symbol(
        request: AIEngineerRequest,
    ) -> AIEngineerResult:
        action = RenameSymbol(
            file_path=request.argument(
                "target_file"
            ),
            old_name=request.argument(
                "old_name"
            ),
            new_name=request.argument(
                "new_name"
            ),
        )

        execution_plan = ExecutionPlan(
            title=(
                "Rename TypeScript symbol: "
                f"{action.old_name} -> "
                f"{action.new_name}"
            ),
            target_project=(
                request.target_project
            ),
            actions=[action],
            metadata={
                "operation": (
                    request.operation.value
                ),
                "old_name": action.old_name,
                "new_name": action.new_name,
            },
        )

        if request.mode == AIEngineerMode.PLAN:
            return AIEngineerResult(
                request=request,
                completed=True,
                message=(
                    "Rename execution plan ready: "
                    f"{action.old_name} -> "
                    f"{action.new_name}"
                ),
            )

        runtime = build_default_runtime(
            project_root=(
                request.target_project
            ),
            dry_run=(
                request.mode
                == AIEngineerMode.PREVIEW
            ),
            show_preview=True,
        )

        runtime_result = runtime.run(
            execution_plan,
            dry_run=(
                request.mode
                == AIEngineerMode.PREVIEW
            ),
            rollback_on_failure=True,
        )

        if not runtime_result.success:
            return AIEngineerResult(
                request=request,
                error=(
                    "; ".join(
                        runtime_result.errors
                    )
                    or "Rename execution failed"
                ),
                message=(
                    "Rename execution failed"
                ),
            )

        if runtime_result.skipped > 0:
            return AIEngineerResult(
                request=request,
                noop=True,
                message=(
                    "Rename skipped because old "
                    "and new names are identical"
                ),
            )

        records = runtime_result.records

        noop = bool(records) and all(
            not record.changed
            for record in records
        )

        if noop:
            message = (
                "Rename produced no changes; "
                "the symbol may not exist"
            )
        elif (
            request.mode
            == AIEngineerMode.PREVIEW
        ):
            message = (
                "Rename preview ready: "
                f"{action.old_name} -> "
                f"{action.new_name}"
            )
        else:
            message = (
                "Symbol renamed: "
                f"{action.old_name} -> "
                f"{action.new_name}"
            )

        return AIEngineerResult(
            request=request,
            noop=noop,
            completed=not noop,
            message=message,
        )

    @staticmethod
    def _handle_create_crud(
        request: AIEngineerRequest,
    ) -> AIEngineerResult:
        generator = CRUDGenerator(
            request.target_project
        )

        crud_plan = generator.plan(
            request.argument(
                "resource_name"
            )
        )

        actions = list(
            generator.build_actions(
                crud_plan
            )
        )

        execution_plan = ExecutionPlan(
            title=(
                "Create CRUD resource: "
                f"{crud_plan.resource_name}"
            ),
            target_project=(
                request.target_project
            ),
            actions=actions,
            metadata={
                "operation": (
                    request.operation.value
                ),
                "resource_name": (
                    crud_plan.resource_name
                ),
                "resource_class": (
                    crud_plan.resource_class
                ),
            },
        )

        if request.mode == AIEngineerMode.PLAN:
            paths = [
                action.file_path
                for action in actions
            ]

            return AIEngineerResult(
                request=request,
                completed=True,
                message=(
                    "CRUD execution plan ready: "
                    + ", ".join(paths)
                ),
            )

        runtime = build_default_runtime(
            project_root=(
                request.target_project
            ),
            dry_run=(
                request.mode
                == AIEngineerMode.PREVIEW
            ),
            show_preview=True,
        )

        runtime_result = runtime.run(
            execution_plan,
            dry_run=(
                request.mode
                == AIEngineerMode.PREVIEW
            ),
            rollback_on_failure=True,
        )

        if not runtime_result.success:
            return AIEngineerResult(
                request=request,
                error=(
                    "; ".join(
                        runtime_result.errors
                    )
                    or "CRUD execution failed"
                ),
                message=(
                    "CRUD execution failed"
                ),
            )

        records = runtime_result.records

        noop = bool(records) and all(
            not record.changed
            for record in records
        )

        changed_paths = [
            action.file_path
            for action, record
            in zip(actions, records)
            if record.changed
        ]

        if noop:
            message = (
                "CRUD resource already exists "
                "with identical content"
            )
        elif request.mode == AIEngineerMode.PREVIEW:
            message = (
                "CRUD preview ready: "
                + ", ".join(changed_paths)
            )
        else:
            message = (
                "CRUD files created: "
                + ", ".join(changed_paths)
            )

        return AIEngineerResult(
            request=request,
            noop=noop,
            completed=not noop,
            message=message,
        )

    @staticmethod
    def _normalize_request(
        request: (
            AIEngineerRequest
            | Mapping[str, Any]
        ),
    ) -> AIEngineerRequest:
        if isinstance(
            request,
            AIEngineerRequest,
        ):
            request.validate_arguments()
            return request

        return AIEngineerRequest.from_mapping(
            request
        )

    @staticmethod
    def _fallback_request(
        request: Any,
    ) -> AIEngineerRequest:
        target_project = "."

        if isinstance(request, Mapping):
            raw_target = request.get(
                "target_project",
                ".",
            )

            if isinstance(raw_target, str):
                target_project = (
                    raw_target.strip() or "."
                )

        return AIEngineerRequest(
            operation=(
                AIEngineerOperation.CONNECT_SERVICE
            ),
            arguments={},
            mode=AIEngineerMode.PLAN,
            target_project=target_project,
        )

    @staticmethod
    def _resolve_request(
        request: AIEngineerRequest,
    ) -> AIEngineerRequest:
        if request.arguments.get("target_file"):
            return request

        project = (
            default_repository_cache.get(
                request.target_project
            )
        )
        resolver = RepositoryResolver(
            project
        )

        arguments = dict(
            request.arguments
        )

        try:
            if request.operation in {
                AIEngineerOperation.CONNECT_SERVICE,
                AIEngineerOperation.CONNECT_CONTROLLER,
            }:
                target = resolver.resolve_class(
                    request.argument(
                        "target_class"
                    )
                )

            elif (
                request.operation
                == AIEngineerOperation
                .REGISTER_MODULE_IMPORT
            ):
                target_class = (
                    request.arguments.get(
                        "target_class"
                    )
                )

                if not isinstance(
                    target_class,
                    str,
                ) or not target_class.strip():
                    raise AIEngineerError(
                        "register_module_import requires "
                        "target_class when target_file "
                        "is omitted"
                    )

                target = resolver.resolve_class(
                    target_class.strip()
                )

            else:
                return request

        except SymbolNotFound as error:
            raise AIEngineerError(
                str(error)
            ) from error

        arguments["target_file"] = (
            target.file_path
        )

        resolved = AIEngineerRequest(
            operation=request.operation,
            arguments=arguments,
            mode=request.mode,
            target_project=(
                request.target_project
            ),
        )

        resolved.validate_arguments()
        return resolved

    @staticmethod
    def _detect_noop(
        request: AIEngineerRequest,
    ) -> str | None:
        target_file = request.argument(
            "target_file"
        )

        project = (
            default_repository_cache.get(
                request.target_project
            )
        )

        if request.operation in {
            AIEngineerOperation.CONNECT_SERVICE,
            AIEngineerOperation.CONNECT_CONTROLLER,
        }:
            dependency_type = request.argument(
                "dependency_type"
            )
            dependency_import = request.argument(
                "dependency_import"
            )

            constructor_dependencies = (
                project
                .constructor_dependencies_of(
                    target_file
                )
            )

            import_dependencies = (
                project.import_dependencies_of(
                    target_file
                )
            )

            has_constructor_dependency = any(
                dependency.target
                == dependency_type
                for dependency
                in constructor_dependencies
            )

            has_import = any(
                dependency.target
                == dependency_import
                and dependency.symbol
                == dependency_type
                for dependency
                in import_dependencies
            )

            if (
                has_constructor_dependency
                and has_import
            ):
                return (
                    f"{dependency_type} is already "
                    f"fully connected in "
                    f"{target_file}"
                )

            return None

        if (
            request.operation
            == AIEngineerOperation
            .REGISTER_MODULE_IMPORT
        ):
            module_class = request.argument(
                "module_class"
            )
            module_import = request.argument(
                "module_import"
            )

            import_dependencies = (
                project.import_dependencies_of(
                    target_file
                )
            )

            has_typescript_import = any(
                dependency.target
                == module_import
                and dependency.symbol
                == module_class
                for dependency
                in import_dependencies
            )

            has_metadata_import = (
                project.has_module_import(
                    target_file,
                    module_class,
                )
            )

            if (
                has_typescript_import
                and has_metadata_import
            ):
                return (
                    f"{module_class} is already "
                    f"registered in {target_file}"
                )

        return None

    def _build_task(
        self,
        request: AIEngineerRequest,
    ):
        if request.operation in {
            AIEngineerOperation.CONNECT_SERVICE,
            AIEngineerOperation.CONNECT_CONTROLLER,
        }:
            return self._build_connect_service_task(
                request
            )

        if (
            request.operation
            == AIEngineerOperation
            .REGISTER_MODULE_IMPORT
        ):
            return (
                self._build_register_module_task(
                    request
                )
            )

        raise AIEngineerError(
            "No task builder registered for "
            f"{request.operation.value!r}"
        )

    @staticmethod
    def _build_connect_service_task(
        request: AIEngineerRequest,
    ) -> ConnectServiceTask:
        return ConnectServiceTask(
            target_file=request.argument(
                "target_file"
            ),
            target_class=request.argument(
                "target_class"
            ),
            dependency_name=request.argument(
                "dependency_name"
            ),
            dependency_type=request.argument(
                "dependency_type"
            ),
            dependency_import=request.argument(
                "dependency_import"
            ),
        )

    @staticmethod
    def _build_register_module_task(
        request: AIEngineerRequest,
    ) -> RegisterModuleImportTask:
        return RegisterModuleImportTask(
            target_file=request.argument(
                "target_file"
            ),
            module_class=request.argument(
                "module_class"
            ),
            module_import=request.argument(
                "module_import"
            ),
        )


def build_default_ai_engineer(
    *,
    runtime: Any | None = None,
) -> AtlasAIEngineer:
    return AtlasAIEngineer(
        planner=build_default_planner(
            runtime=runtime,
        )
    )
