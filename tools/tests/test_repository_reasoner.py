from __future__ import annotations

from tools.ai_engineer import (
    EngineeringRisk,
    IntentType,
    RelatedFileRole,
    RepositoryReasoner,
    RuleBasedIntentParser,
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


def build_ui_repository(
    tmp_path,
):
    write_file(
        tmp_path,
        "apps/web/src/components/"
        "DashboardOverview.tsx",
        (
            "import styles from "
            "'./DashboardOverview.module.css';\n"
            "\n"
            "export function "
            "DashboardOverview() {\n"
            "  return <main "
            "className={styles.dashboard} />;\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "DashboardOverview.module.css",
        (
            ".dashboard {\n"
            "  display: grid;\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "apps/web/src/app/page.tsx",
        (
            "import { DashboardOverview } "
            "from '../components/"
            "DashboardOverview';\n"
            "\n"
            "export default function Page() {\n"
            "  return <DashboardOverview />;\n"
            "}\n"
        ),
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

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "Sidebar.tsx",
        (
            "export function Sidebar() {\n"
            "  return null;\n"
            "}\n"
        ),
    )

    write_file(
        tmp_path,
        "apps/web/src/app/globals.css",
        "body { margin: 0; }\n",
    )

    write_file(
        tmp_path,
        "apps/web/src/components/"
        "UnrelatedWidget.tsx",
        (
            "export function "
            "UnrelatedWidget() {\n"
            "  return null;\n"
            "}\n"
        ),
    )


def test_dashboard_reasoning_finds_primary_files(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "把 Dashboard 重新设计，"
        "留白多一点，手机版也一起优化"
    )

    assert intent.intent_type == (
        IntentType.REDESIGN_UI
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    paths = {
        item.file_path
        for item in plan.related_files
    }

    assert (
        "apps/web/src/components/"
        "DashboardOverview.tsx"
        in paths
    )

    assert (
        "apps/web/src/components/"
        "DashboardOverview.module.css"
        in paths
    )

    assert plan.related_files[0].score >= 60
    assert plan.requires_approval
    assert not plan.executable


def test_dashboard_reasoning_adds_shared_ui(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    paths = {
        item.file_path
        for item in plan.related_files
    }

    assert (
        "apps/web/src/components/"
        "AppLayout.tsx"
        in paths
    )

    assert (
        "apps/web/src/components/"
        "Sidebar.tsx"
        in paths
    )

    assert (
        "apps/web/src/app/globals.css"
        in paths
    )


def test_reasoning_classifies_file_roles(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    by_path = {
        item.file_path: item
        for item in plan.related_files
    }

    assert by_path[
        "apps/web/src/components/"
        "DashboardOverview.tsx"
    ].role == RelatedFileRole.PRIMARY

    assert by_path[
        "apps/web/src/components/"
        "DashboardOverview.module.css"
    ].role == RelatedFileRole.STYLE

    assert by_path[
        "apps/web/src/components/"
        "AppLayout.tsx"
    ].role == RelatedFileRole.LAYOUT


def test_reasoning_excludes_unrelated_component(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    paths = {
        item.file_path
        for item in plan.related_files
    }

    assert (
        "apps/web/src/components/"
        "UnrelatedWidget.tsx"
        not in paths
    )


def test_reasoning_builds_impact_and_actions(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    assert plan.impact.affected_files >= 3
    assert plan.impact.component_files >= 1
    assert plan.impact.style_files >= 1
    assert plan.confidence > 0.5

    assert any(
        "preview" in action.lower()
        for action
        in plan.recommended_actions
    )


def test_empty_evidence_is_high_risk(
    tmp_path,
):
    write_file(
        tmp_path,
        "src/example.ts",
        "export const value = 1;\n",
    )

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the GalacticConsole UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    assert not plan.related_files
    assert plan.risk == (
        EngineeringRisk.HIGH
    )
    assert plan.warnings


def test_plan_to_dict(
    tmp_path,
):
    build_ui_repository(tmp_path)

    default_repository_cache.clear()

    intent = RuleBasedIntentParser().parse(
        "Redesign the Dashboard UI"
    )

    plan = RepositoryReasoner().reason(
        intent,
        target_project=str(tmp_path),
    )

    payload = plan.to_dict()

    assert payload["executable"] is False
    assert payload[
        "requires_approval"
    ] is True
    assert payload["related_files"]
    assert payload["impact"][
        "affected_files"
    ] == len(
        payload["related_files"]
    )
