"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./CampaignPlanner.module.css";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  brand: {
    name: string;
  };
};

type CampaignIdea = {
  id: string;
  title: string;
  angle: string;
  hook: string;
  platform: string;
  style: string;
  language: string;
  status: string;
  sortOrder: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function CampaignPlanner({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
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
    void load();
  }, [campaignId]);

  async function load() {
    try {
      const [campaignResponse, ideasResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/campaigns/${campaignId}`, {
          cache: "no-store",
        }),
        fetch(`${API_BASE_URL}/campaigns/${campaignId}/plan`, {
          cache: "no-store",
        }),
      ]);

      const campaignData = (await campaignResponse.json()) as Campaign;
      const ideasData = (await ideasResponse.json()) as CampaignIdea[];

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
        error instanceof Error ? error.message : "Unable to load campaign.",
      );
    }
  }

  async function generatePlan(event: FormEvent<HTMLFormElement>) {
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
        throw new Error(data.message || "Unable to generate campaign plan.");
      }

      setIdeas(data.ideas);
      setStatus(`${data.ideas.length} new campaign ideas generated.`);
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
    const confirmed = window.confirm(`Delete "${idea.title}"?`);
    if (!confirmed) return;

    const response = await fetch(
      `${API_BASE_URL}/campaigns/${campaignId}/plan/${idea.id}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) return;

    setIdeas((current) => current.filter((item) => item.id !== idea.id));
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

    window.location.href = `/ai-studio?${query.toString()}`;
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <a href="/campaigns" className={styles.backLink}>
            ← Campaigns
          </a>
          <p className={styles.eyebrow}>AI Campaign Planner</p>
          <h1>{campaign?.name || "Campaign workspace"}</h1>
          <p>
            {campaign?.description ||
              "Plan a complete set of campaign topics from one strategic direction."}
          </p>
        </div>

        <div className={styles.campaignMeta}>
          <span>{campaign?.brand.name || "Brand"}</span>
          <strong>{campaign?.status || "Loading"}</strong>
          <small>{campaign?.objective || "No objective configured"}</small>
        </div>
      </section>

      <section className={styles.layout}>
        <form className={styles.plannerCard} onSubmit={generatePlan}>
          <div className={styles.cardHeading}>
            <span>Campaign brief</span>
            <h2>Generate the content roadmap</h2>
          </div>

          <label className={styles.field}>
            <span>Number of ideas</span>
            <input
              type="number"
              min={3}
              max={30}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>

          <label className={styles.field}>
            <span>Strategic direction</span>
            <textarea
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
            />
          </label>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option>Chinese</option>
                <option>English</option>
                <option>Bilingual</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>Style</span>
              <select
                value={style}
                onChange={(event) => setStyle(event.target.value)}
              >
                <option>Nostalgia</option>
                <option>Funny</option>
                <option>Motivation</option>
                <option>Lifestyle</option>
                <option>Soft Sell</option>
                <option>Educational</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>Platform</span>
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
              >
                <option>Multi-platform</option>
                <option>Facebook</option>
                <option>Telegram</option>
                <option>Reels</option>
              </select>
            </label>
          </div>

          <button className={styles.generateButton} disabled={isGenerating}>
            {isGenerating ? "Planning campaign..." : "✦ Generate campaign plan"}
          </button>

          <p className={styles.status}>{status}</p>
        </form>

        <section className={styles.ideaArea}>
          <div className={styles.ideaHeading}>
            <div>
              <p className={styles.eyebrow}>Content roadmap</p>
              <h2>{ideas.length} planned ideas</h2>
            </div>
            <button onClick={() => void load()}>Refresh</button>
          </div>

          {ideas.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>No campaign ideas yet</strong>
              <span>Complete the brief and generate your first roadmap.</span>
            </div>
          ) : (
            <div className={styles.ideaGrid}>
              {ideas.map((idea) => (
                <article className={styles.ideaCard} key={idea.id}>
                  <div className={styles.ideaTop}>
                    <span>#{String(idea.sortOrder).padStart(2, "0")}</span>
                    <small>{idea.platform}</small>
                  </div>

                  <h3>{idea.title}</h3>

                  <div className={styles.ideaBlock}>
                    <span>Angle</span>
                    <p>{idea.angle}</p>
                  </div>

                  <div className={styles.ideaBlock}>
                    <span>Opening hook</span>
                    <p>{idea.hook}</p>
                  </div>

                  <div className={styles.tags}>
                    <span>{idea.style}</span>
                    <span>{idea.language}</span>
                    <span>{idea.status}</span>
                  </div>

                  <div className={styles.actions}>
                    <button onClick={() => openInStudio(idea)}>
                      Open in AI Studio
                    </button>
                    <button
                      className={styles.deleteButton}
                      onClick={() => void deleteIdea(idea)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
