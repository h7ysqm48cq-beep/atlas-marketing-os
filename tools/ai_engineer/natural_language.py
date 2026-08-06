from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .adapter import (
    IntentAdaptationResult,
    IntentToRequestAdapter,
)
from .engine import (
    AtlasAIEngineer,
    build_default_ai_engineer,
)
from .intent import EngineeringIntent
from .parser import RuleBasedIntentParser
from .repository_reasoner import (
    EngineeringPlan,
    RepositoryReasoner,
)
from .request import AIEngineerMode
from .result import AIEngineerResult


@dataclass(
    slots=True,
    kw_only=True,
)
class NaturalLanguageEngineerResult:
    text: str
    intent: EngineeringIntent

    adaptation: (
        IntentAdaptationResult | None
    ) = None

    engineering_plan: (
        EngineeringPlan | None
    ) = None

    engineer_result: (
        AIEngineerResult | None
    ) = None

    error: str | None = None

    @property
    def success(self) -> bool:
        if self.error is not None:
            return False

        if self.engineer_result is not None:
            return self.engineer_result.success

        return (
            self.engineering_plan is not None
            or self.adaptation is not None
        )

    @property
    def requires_review(self) -> bool:
        if self.engineering_plan is not None:
            return True

        if self.adaptation is not None:
            return (
                self.adaptation
                .requires_review
            )

        return True

    @property
    def executed(self) -> bool:
        return bool(
            self.engineer_result
            and self.engineer_result.executed
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "text": self.text,
            "intent": self.intent.to_dict(),
            "requires_review": (
                self.requires_review
            ),
            "executed": self.executed,
            "adaptation": (
                self.adaptation.to_dict()
                if self.adaptation
                else None
            ),
            "engineering_plan": (
                self.engineering_plan.to_dict()
                if self.engineering_plan
                else None
            ),
            "engineer_result": (
                self.engineer_result.to_dict()
                if self.engineer_result
                else None
            ),
            "error": self.error,
        }


class NaturalLanguageEngineer:
    """
    Safe natural-language entry point.

    Simple, fully understood operations can be
    adapted into AIEngineerRequest.

    Complex or ambiguous requests are routed to
    RepositoryReasoner and remain planning-only.
    """

    def __init__(
        self,
        *,
        parser: (
            RuleBasedIntentParser | None
        ) = None,
        adapter: (
            IntentToRequestAdapter | None
        ) = None,
        reasoner: (
            RepositoryReasoner | None
        ) = None,
        engineer: (
            AtlasAIEngineer | None
        ) = None,
    ) -> None:
        self.parser = (
            parser
            or RuleBasedIntentParser()
        )

        self.adapter = (
            adapter
            or IntentToRequestAdapter()
        )

        self.reasoner = (
            reasoner
            or RepositoryReasoner()
        )

        self.engineer = (
            engineer
            or build_default_ai_engineer()
        )

    def handle(
        self,
        text: str,
        *,
        target_project: str = ".",
        mode: AIEngineerMode = (
            AIEngineerMode.PLAN
        ),
        allow_apply: bool = False,
    ) -> NaturalLanguageEngineerResult:
        intent = self.parser.parse(text)

        try:
            adaptation = self.adapter.adapt(
                intent,
                target_project=target_project,
                mode=mode,
                allow_apply=allow_apply,
            )

            if adaptation.request is not None:
                engineer_result = (
                    self.engineer.handle(
                        adaptation.request
                    )
                )

                return (
                    NaturalLanguageEngineerResult(
                        text=text,
                        intent=intent,
                        adaptation=adaptation,
                        engineer_result=(
                            engineer_result
                        ),
                    )
                )

            plan = self.reasoner.reason(
                intent,
                target_project=target_project,
            )

            return (
                NaturalLanguageEngineerResult(
                    text=text,
                    intent=intent,
                    adaptation=adaptation,
                    engineering_plan=plan,
                )
            )

        except Exception as error:
            return (
                NaturalLanguageEngineerResult(
                    text=text,
                    intent=intent,
                    error=(
                        f"{type(error).__name__}: "
                        f"{error}"
                    ),
                )
            )


def build_natural_language_engineer(
) -> NaturalLanguageEngineer:
    return NaturalLanguageEngineer()
