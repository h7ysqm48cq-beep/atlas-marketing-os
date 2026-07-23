"use client";

import { FormEvent, useEffect, useState } from "react";
import { CampaignDashboard } from "./CampaignDashboard";
import { CampaignAssets } from "./CampaignAssets";
import styles from "./CampaignPlanner.module.css";
import { CampaignStrategy } from "./CampaignStrategy";
import { CampaignIdeaGenerator } from "./campaign-planner/CampaignIdeaGenerator";
import { CampaignIdeaList } from "./campaign-planner/CampaignIdeaList";
import { CampaignPlannerHero } from "./campaign-planner/CampaignPlannerHero";
import {
  Campaign,
  CampaignIdea,
  CampaignWorkspaceTab,
} from "./campaign-planner/campaign-planner.types";
import { CampaignWorkspaceTabs } from "./campaign-planner/CampaignWorkspaceTabs";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function CampaignPlanner({
  campaignId,
}: {
  campaignId: string;
}) {
  const [campaign, setCampaign] =
    useState<Campaign | null>(null);

  const [activeTab, setActiveTab] =
    useState<CampaignWorkspaceTab>("overview");

  const [ideas, setIdeas] = useState<CampaignIdea[]>([]);
  const [count, setCount] = useState(10);

  const [direction, setDirection] = useState(
    "Create discussion-led nostalgic content with strong emotional recall.",
  );

  const [language, setLanguage] = useState("Chinese");
  const [style, setStyle] = useState("Nostalgia");
  const [platform, setPlatform] = useState("Multi-platform");
  const [status, setStatus] = useState("Loading campaign...");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");

    if (
      requestedTab === "overview" ||
      requestedTab === "strategy" ||
      requestedTab === "ideas" ||
      requestedTab === "assets"
    ) {
      setActiveTab(requestedTab);
    }

    void load();
  }, [campaignId]);

  async function load() {
    try {
      const [campaignResponse, ideasResponse] =
        await Promise.all([
          fetch(`${API_BASE_URL}/campaigns/${campaignId}`, {
            cache: "no-store",
          }),
          fetch(
            `${API_BASE_URL}/campaigns/${campaignId}/plan`,
            {
              cache: "no-store",
            },
          ),
        ]);

      const campaignData =
        (await campaignResponse.json()) as Campaign;

      const ideasData =
        (await ideasResponse.json()) as CampaignIdea[];

      if (!campaignResponse.ok) {
        throw new Error("Unable to load campaign.");
      }

      if (!ideasResponse.ok || !Array.isArray(ideasData)) {
        throw new Error("Unable to load campaign plan.");
      }

      setCampaign(campaignData);
      setIdeas(ideasData);

      setStatus(
        ideasData.length === 0
          ? "No content ideas generated yet."
          : `${ideasData.length} campaign ideas loaded.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to load campaign.",
      );
    }
  }

  async function generatePlan(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setIsGenerating(true);
    setStatus("Atlas is planning the campaign...");

    try {
      const response = await fetch(
        `${API_BASE_URL}/campaigns/${campaignId}/plan/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            count,
            direction,
            language,
            style,
            platform,
          }),
        },
      );

      const data = (await response.json()) as {
        ideas?: CampaignIdea[];
        message?: string;
      };

      if (!response.ok || !data.ideas) {
        throw new Error(
          data.message || "Unable to generate campaign plan.",
        );
      }

      setIdeas(data.ideas);
      setStatus(
        `${data.ideas.length} new campaign ideas generated.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to generate campaign plan.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function deleteIdea(idea: CampaignIdea) {
    const confirmed = window.confirm(
      `Delete "${idea.title}"?`,
    );

    if (!confirmed) return;

    const response = await fetch(
      `${API_BASE_URL}/campaigns/${campaignId}/plan/${idea.id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      setStatus("Unable to delete campaign idea.");
      return;
    }

    setIdeas((current) =>
      current.filter((item) => item.id !== idea.id),
    );

    setStatus(`"${idea.title}" deleted.`);
  }

  function openInStudio(idea: CampaignIdea) {
    const query = new URLSearchParams({
      topic: idea.title,
      style: idea.style,
      language: idea.language,
      campaignId,
      ideaId: idea.id,
      campaignName: campaign?.name || "",
      ideaTitle: idea.title,
    });

    window.location.href =
      `/ai-studio?${query.toString()}`;
  }

  return (
    <div className={styles.page}>
      <CampaignPlannerHero campaign={campaign} />

      <CampaignWorkspaceTabs
        activeTab={activeTab}
        ideaCount={ideas.length}
        onChange={(tab) => {
          setActiveTab(tab);

          const url = new URL(window.location.href);
          url.searchParams.set("tab", tab);
          window.history.replaceState({}, "", url);
        }}
      />

      {activeTab === "overview" && campaign ? (
        <CampaignDashboard
          campaign={campaign}
          onOpenStrategy={() => setActiveTab("strategy")}
          onOpenIdeas={() => setActiveTab("ideas")}
        />
      ) : null}

      {activeTab === "strategy" && campaign ? (
        <CampaignStrategy
          campaignId={campaign.id}
          campaignName={campaign.name}
          objective={campaign.objective}
        />
      ) : null}

      {activeTab === "assets" && campaign ? (
        <CampaignAssets
          campaignId={campaign.id}
          campaignName={campaign.name}
        />
      ) : null}

      {activeTab === "ideas" ? (
        <section className={styles.layout}>
          <CampaignIdeaGenerator
            count={count}
            direction={direction}
            language={language}
            style={style}
            platform={platform}
            status={status}
            isGenerating={isGenerating}
            onCountChange={setCount}
            onDirectionChange={setDirection}
            onLanguageChange={setLanguage}
            onStyleChange={setStyle}
            onPlatformChange={setPlatform}
            onSubmit={generatePlan}
          />

          <CampaignIdeaList
            ideas={ideas}
            onRefresh={() => void load()}
            onOpen={openInStudio}
            onDelete={(idea) => void deleteIdea(idea)}
          />
        </section>
      ) : null}
    </div>
  );
}
