from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
import posixpath

from tools.repository import (
    RepositoryResolutionError,
    RepositoryResolver,
    SymbolNotFound,
    default_repository_cache,
)

from .intent import (
    EngineeringIntent,
    IntentType,
)
from .request import (
    AIEngineerMode,
    AIEngineerOperation,
    AIEngineerRequest,
)


class IntentAdapterError(RuntimeError):
    """Raised when an intent cannot be adapted safely."""


@dataclass(
    slots=True,
    frozen=True,
    kw_only=True,
)
class IntentAdaptationResult:
    intent: EngineeringIntent
    request: AIEngineerRequest | None

    requires_review: bool = False
    message: str | None = None

    @property
    def executable(self) -> bool:
        return self.request is not None

    def to_dict(self) -> dict:
        return {
            "intent": self.intent.to_dict(),
            "request": (
                self.request.to_dict()
                if self.request is not None
                else None
            ),
            "requires_review": (
                self.requires_review
            ),
            "message": self.message,
            "executable": self.executable,
        }


class IntentToRequestAdapter:
    """
    Convert a trusted EngineeringIntent into the
    existing AIEngineerRequest format.

    APPLY is denied unless the caller explicitly
    provides allow_apply=True. This is where future
    role and approval checks will be connected.
    """

    def adapt(
        self,
        intent: EngineeringIntent,
        *,
        target_project: str = ".",
        mode: AIEngineerMode = (
            AIEngineerMode.PLAN
        ),
        allow_apply: bool = False,
    ) -> IntentAdaptationResult:
        if not isinstance(
            intent,
            EngineeringIntent,
        ):
            raise TypeError(
                "intent must be an "
                "EngineeringIntent"
            )

        if not isinstance(
            mode,
            AIEngineerMode,
        ):
            mode = AIEngineerMode(mode)

        if (
            mode == AIEngineerMode.APPLY
            and not allow_apply
        ):
            raise IntentAdapterError(
                "Apply mode is not authorized. "
                "Create a plan or preview and "
                "request approval first."
            )

        if intent.intent_type == (
            IntentType.RENAME_SYMBOL
        ):
            return self._adapt_rename(
                intent,
                target_project=target_project,
                mode=mode,
            )

        if intent.intent_type == (
            IntentType.CONNECT_DEPENDENCY
        ):
            return self._adapt_connect_dependency(
                intent,
                target_project=target_project,
                mode=mode,
            )

        if intent.intent_type == (
            IntentType.CREATE_CRUD
        ):
            request = AIEngineerRequest(
                operation=(
                    AIEngineerOperation
                    .CREATE_CRUD
                ),
                arguments={
                    "resource_name": str(
                        intent.arguments[
                            "resource_name"
                        ]
                    ),
                },
                mode=mode,
                target_project=(
                    target_project
                ),
            )

            request.validate_arguments()

            return IntentAdaptationResult(
                intent=intent,
                request=request,
                requires_review=False,
                message=(
                    "CRUD request is ready "
                    f"in {mode.value} mode."
                ),
            )

        return IntentAdaptationResult(
            intent=intent,
            request=None,
            requires_review=True,
            message=(
                intent.reason
                or "This request requires "
                "repository analysis and review."
            ),
        )



    @staticmethod
    def _adapt_connect_dependency(
        intent: EngineeringIntent,
        *,
        target_project: str,
        mode: AIEngineerMode,
    ) -> IntentAdaptationResult:
        target_class = str(
            intent.arguments.get("target_class", "")
        ).strip()
        dependency_type = str(
            intent.arguments.get("dependency_type", "")
        ).strip()

        if not target_class or not dependency_type:
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=(
                    "Dependency wiring requires exact target "
                    "and dependency class names."
                ),
            )

        if target_class.endswith("Controller"):
            operation = AIEngineerOperation.CONNECT_CONTROLLER
        elif target_class.endswith("Service"):
            operation = AIEngineerOperation.CONNECT_SERVICE
        else:
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=(
                    "Dependency wiring is executable only for "
                    "unambiguous Service or Controller targets."
                ),
            )

        project = default_repository_cache.get(
            target_project
        )
        resolver = RepositoryResolver(project)

        try:
            target = resolver.resolve_class(target_class)
            dependency = resolver.resolve_class(
                dependency_type
            )
        except RepositoryResolutionError as error:
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=str(error),
            )

        if (
            target.file_path == dependency.file_path
            or not dependency.symbol.exported
        ):
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=(
                    "Dependency wiring requires a distinct, "
                    "exported repository class."
                ),
            )

        dependency_import = (
            IntentToRequestAdapter
            ._relative_typescript_import(
                target.file_path,
                dependency.file_path,
            )
        )
        dependency_name = (
            IntentToRequestAdapter
            ._dependency_parameter_name(
                dependency_type
            )
        )

        target_source = target.absolute_path.read_text(
            encoding="utf-8"
        )
        if "constructor(" not in target_source and "constructor (" not in target_source:
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=(
                    "Structured dependency wiring requires an "
                    "existing constructor in the target class."
                ),
            )

        if (
            f"{dependency_name}:" in target_source
            or f"{dependency_name} :" in target_source
        ):
            return IntentAdaptationResult(
                intent=intent,
                request=None,
                requires_review=True,
                message=(
                    "Derived constructor parameter name already "
                    "exists in the target file."
                ),
            )

        request = AIEngineerRequest(
            operation=operation,
            arguments={
                "target_file": target.file_path,
                "target_class": target_class,
                "dependency_name": dependency_name,
                "dependency_type": dependency_type,
                "dependency_import": dependency_import,
            },
            mode=mode,
            target_project=target_project,
        )
        request.validate_arguments()

        return IntentAdaptationResult(
            intent=intent,
            request=request,
            requires_review=False,
            message=(
                f"{dependency_type} resolved to "
                f"{dependency.file_path} for {target.file_path}."
            ),
        )

    @staticmethod
    def _relative_typescript_import(
        target_file: str,
        dependency_file: str,
    ) -> str:
        target_dir = PurePosixPath(
            target_file
        ).parent.as_posix()
        dependency_path = PurePosixPath(
            dependency_file
        ).with_suffix("").as_posix()

        relative = posixpath.relpath(
            dependency_path,
            target_dir,
        )
        if not relative.startswith("."):
            relative = "./" + relative
        return relative

    @staticmethod
    def _dependency_parameter_name(
        dependency_type: str,
    ) -> str:
        stem = dependency_type
        for suffix in (
            "Service",
            "Controller",
            "Repository",
            "Gateway",
            "Client",
            "Provider",
        ):
            if stem.endswith(suffix) and len(stem) > len(suffix):
                stem = stem[: -len(suffix)]
                break

        return stem[:1].lower() + stem[1:]

    @staticmethod
    def _adapt_rename(
        intent: EngineeringIntent,
        *,
        target_project: str,
        mode: AIEngineerMode,
    ) -> IntentAdaptationResult:
        old_name = str(
            intent.arguments["old_name"]
        )
        new_name = str(
            intent.arguments["new_name"]
        )

        project = (
            default_repository_cache.get(
                target_project
            )
        )

        resolver = RepositoryResolver(
            project
        )

        try:
            target = (
                resolver.resolve_symbol(
                    old_name
                )
            )
        except SymbolNotFound as error:
            raise IntentAdapterError(
                str(error)
            ) from error

        request = AIEngineerRequest(
            operation=(
                AIEngineerOperation
                .RENAME_SYMBOL
            ),
            arguments={
                "target_file": (
                    target.file_path
                ),
                "old_name": old_name,
                "new_name": new_name,
            },
            mode=mode,
            target_project=target_project,
        )

        request.validate_arguments()

        return IntentAdaptationResult(
            intent=intent,
            request=request,
            requires_review=False,
            message=(
                "Rename request resolved to "
                f"{target.file_path} in "
                f"{mode.value} mode."
            ),
        )
