"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./CampaignDashboard.module.css";
import { AtlasRecommendation } from "./campaign-dashboard/AtlasRecommendation";
import { CampaignIntelligence } from "./campaign-dashboard/CampaignIntelligence";
import { CampaignPipeline } from "./campaign-dashboard/CampaignPipeline";
import {
  DashboardCampaign,
  DashboardHistoryItem,
  DashboardIdea,
  DashboardMemory,
} from "./campaign-dashboard/campaign-dashboard.types";
import {
  calculateDashboardMetrics,
  getCampaignRecommendation,
} from "./campaign-dashboard/campaign-dashboard.utils";
import { DashboardMetric } from "./campaign-dashboard/DashboardShared";
import { ExecutiveSummary } from "./campaign-dashboard/ExecutiveSummary";
import { MemoryInsights } from "./campaign-dashboard/MemoryInsights";
import { QuickActions } from "./campaign-dashboard/QuickActions";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function CampaignDashboard({
  campaign,
  onOpenStrategy,
  onOpenIdeas,
}: {
  campaign: DashboardCampaign;
  onOpenStrategy: () => void;
  onOpenIdeas: () => void;
}) {
  const [ideas, setIdeas] = useState<DashboardIdea[]>([]);
  const [history, setHistory] = useState<DashboardHistoryItem[]>([]);
  const [memory, setMemory] = useState<DashboardMemory | null>(null);
  const [message, setMessage] = useState(
    "Loading campaign intelligence...",
  );

  useEffect(() => {
    void loadDashboard();
  }, [campaign.id]);

  async function loadDashboard() {
    setMessage("Loading campaign intelligence...");

    try {
      const [ideasResponse, historyResponse, memoryResponse] =
        await Promise.all([
          fetch(`${API_BASE_URL}/campaigns/${campaign.id}/plan`, {
            cache: "no-store",
          }),
          fetch(`${API_BASE_URL}/history`, {
            cache: "no-store",
          }),
          fetch(`${API_BASE_URL}/memory/summary`, {
            cache: "no-store",
          }),
        ]);

      const ideasData = (await ideasResponse.json()) as DashboardIdea[];
      const historyData =
        (await historyResponse.json()) as DashboardHistoryItem[];
      const memoryData = (await memoryResponse.json()) as DashboardMemory;

      if (!ideasResponse.ok || !Array.isArray(ideasData)) {
        throw new Error("Unable to load campaign ideas.");
      }

      if (!historyResponse.ok || !Array.isArray(historyData)) {
        throw new Error("Unable to load campaign history.");
      }

      if (!memoryResponse.ok) {
        throw new Error("Unable to load Atlas Memory.");
      }

      setIdeas(ideasData);
      setHistory(
        historyData.filter(
          (item) => item.campaignId === campaign.id,
        ),
      );
      setMemory(memoryData);
      setMessage("Campaign intelligence is up to date.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load campaign dashboard.",
      );
    }
  }

  const metrics = useMemo(
    () =>
      calculateDashboardMetrics(
        campaign,
        ideas,
        history,
        memory,
      ),
    [campaign, ideas, history, memory],
  );

  const recommendation = getCampaignRecommendation(
    metrics,
    memory,
  );

  return (
    <section className={styles.dashboard}>
      <ExecutiveSummary
        campaign={campaign}
        health={metrics.health}
      />

      <section className={styles.metricGrid}>
        <DashboardMetric
          label="Ideas"
          value={String(metrics.ideas)}
          detail="Planned roadmap"
        />

        <DashboardMetric
          label="Generated"
          value={String(metrics.generated)}
          detail="Content workspaces"
        />

        <DashboardMetric
          label="Approved"
          value={String(metrics.approved)}
          detail="Ready to publish"
        />

        <DashboardMetric
          label="Published"
          value={String(metrics.published)}
          detail="Completed workflow"
        />

        <DashboardMetric
          label="Platforms"
          value={String(metrics.platformCount)}
          detail="Coverage"
        />

        <DashboardMetric
          label="Memory"
          value={`${memory?.confidence || 0}%`}
          detail={`${memory?.learningSampleSize || 0} learned records`}
        />
      </section>

      <CampaignIntelligence
        metrics={metrics}
        memory={memory}
      />

      <section className={styles.twoColumnGrid}>
        <CampaignPipeline metrics={metrics} />

        <AtlasRecommendation
          title={recommendation.title}
          reason={recommendation.reason}
          priority={recommendation.priority}
        />
      </section>

      <section className={styles.twoColumnGrid}>
        <MemoryInsights memory={memory} />

        <QuickActions
          campaignId={campaign.id}
          onOpenStrategy={onOpenStrategy}
          onOpenIdeas={onOpenIdeas}
        />
      </section>

      <div className={styles.dashboardFooter}>
        <span>{message}</span>

        <button type="button" onClick={() => void loadDashboard()}>
          Refresh intelligence
        </button>
      </div>
    </section>
  );
}
