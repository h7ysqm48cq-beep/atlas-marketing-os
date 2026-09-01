from __future__ import annotations

from tools.ai_engineer import (
    EngineeringIntent,
    IntentType,
    RepositoryReasoner,
)
from tools.repository import default_repository_cache


def test_filename_matching_ignores_conjunction_stop_words(tmp_path):
    component = (
        tmp_path
        / "apps/web/src/components/BrandCopilot.tsx"
    )
    component.parent.mkdir(parents=True, exist_ok=True)
    component.write_text(
        "export function BrandCopilot() { return null; }\n",
        encoding="utf-8",
    )

    default_repository_cache.clear()

    intent = EngineeringIntent(
        intent_type=IntentType.REDESIGN_UI,
        raw_text="Improve BrandCopilot and CSS",
        target="BrandCopilot",
        confidence=0.9,
        requires_review=True,
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    brand_copilot = next(
        item
        for item in plan.related_files
        if item.file_path.endswith("BrandCopilot.tsx")
    )

    assert "filename contains and" not in {
        reason.lower()
        for reason in brand_copilot.reasons
    }
    assert not {
        "and",
        "or",
    }.intersection(
        term.lower()
        for term in RepositoryReasoner._search_terms(intent)
    )
