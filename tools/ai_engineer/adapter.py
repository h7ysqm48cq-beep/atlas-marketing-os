from __future__ import annotations

from dataclasses import dataclass

from tools.repository import (
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
