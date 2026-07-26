import {
  DashboardCampaign,
  DashboardHistoryItem,
  DashboardIdea,
  DashboardMemory,
  DashboardMetrics,
} from "./campaign-dashboard.types";

export function calculateDashboardMetrics(
  campaign: DashboardCampaign,
  ideas: DashboardIdea[],
  history: DashboardHistoryItem[],
  memory: DashboardMemory | null,
): DashboardMetrics {
  const generated = history.length;
  const approved = history.filter(
    (item) => item.status === "APPROVED",
  ).length;
  const published = history.filter(
    (item) => item.status === "PUBLISHED",
  ).length;

  const platforms = new Set<string>();

  ideas.forEach((idea) => {
    idea.platform
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => platforms.add(value));
  });

  history.forEach((item) => {
    item.platforms?.forEach((platform) => platforms.add(platform));
  });

  let health = 0;

  if (campaign.description) health += 10;
  if (campaign.objective) health += 15;
  if (ideas.length >= 5) health += 20;
  if (generated >= 1) health += 15;
  if (approved >= 1) health += 15;
  if (published >= 1) health += 10;
  if (platforms.size >= 2) health += 10;
  if ((memory?.confidence || 0) >= 40) health += 5;

  return {
    ideas: ideas.length,
    generated,
    approved,
    published,
    platformCount: platforms.size,
    health: Math.min(100, health),
  };
}

export function getCampaignRecommendation(
  metrics: DashboardMetrics,
  memory: DashboardMemory | null,
) {
  if (metrics.ideas === 0) {
    return {
      title: "Create the campaign roadmap",
      reason:
        "The campaign needs a planned set of content ideas before production begins.",
      priority: "High",
    };
  }

  if (metrics.generated < metrics.ideas) {
    return {
      title: "Generate planned content",
      reason: `${metrics.ideas - metrics.generated} planned ideas have not yet been converted into content workspaces.`,
      priority: "High",
    };
  }

  if (metrics.approved < metrics.generated) {
    return {
      title: "Complete content review",
      reason: `${metrics.generated - metrics.approved} generated items still require approval.`,
      priority: "High",
    };
  }

  if (metrics.published < metrics.approved) {
    return {
      title: "Publish approved content",
      reason: `${metrics.approved - metrics.published} approved items are ready for the next workflow stage.`,
      priority: "Medium",
    };
  }

  if ((memory?.confidence || 0) < 40) {
    return {
      title: "Strengthen Atlas Memory",
      reason:
        "More approved and published content will improve recommendation reliability.",
      priority: "Medium",
    };
  }

  return {
    title: "Review campaign performance",
    reason:
      "The workflow is healthy. Review current results before beginning the next content cycle.",
    priority: "Normal",
  };
}

export function formatDashboardDate(value: string | null) {
  if (!value) return "Not configured";

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
  }).format(new Date(value));
}
