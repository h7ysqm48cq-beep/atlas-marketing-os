"use client";

import { useEffect, useState } from "react";
import styles from "./CampaignStrategy.module.css";
import { CampaignStrategyResult } from "./campaign-strategy/campaign-strategy.types";
import { StrategyContent } from "./campaign-strategy/StrategyContent";
import { StrategyControls } from "./campaign-strategy/StrategyControls";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function CampaignStrategy({
  campaignId,
  campaignName,
  objective,
}: {
  campaignId: string;
  campaignName: string;
  objective?: string | null;
}) {
  const [result, setResult] =
    useState<CampaignStrategyResult | null>(null);

  const [durationDays, setDurationDays] = useState(30);
  const [style, setStyle] = useState("Nostalgia");
  const [language, setLanguage] = useState("Chinese");

  const [platforms, setPlatforms] = useState([
    "Facebook",
    "Telegram",
    "Reels",
  ]);

  const [isGenerating, setIsGenerating] = useState(false);

  const [message, setMessage] = useState(
    "Generate a strategy using Brand Brain, Campaign Context and Atlas Memory.",
  );

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const storageKey = `atlas-campaign-strategy:${campaignId}`;
    const cached = window.localStorage.getItem(storageKey);

    if (!cached) return;

    try {
      setResult(JSON.parse(cached) as CampaignStrategyResult);
      setMessage("Previously generated strategy restored.");
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [campaignId]);

  function togglePlatform(platform: string) {
    setPlatforms((current) =>
      current.includes(platform)
        ? current.filter((value) => value !== platform)
        : [...current, platform],
    );
  }

  async function generateStrategy() {
    if (platforms.length === 0) {
      setMessage("Select at least one platform.");
      return;
    }

    setIsGenerating(true);
    setMessage("Atlas is building the campaign strategy...");

    try {
      const response = await fetch(
        `${API_BASE_URL}/campaign-strategy/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            campaignId,
            objective: objective || undefined,
            durationDays,
            platforms,
            style,
            language,
          }),
        },
      );

      const data = (await response.json()) as
        | CampaignStrategyResult
        | { message?: string };

      if (!response.ok || !("strategy" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to generate campaign strategy.",
        );
      }

      setResult(data);

      window.localStorage.setItem(
        `atlas-campaign-strategy:${campaignId}`,
        JSON.stringify(data),
      );

      setMessage("Campaign strategy generated successfully.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to generate campaign strategy.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyStrategy() {
    if (!result) return;

    const strategy = result.strategy;

    const copyText = [
      `CAMPAIGN STRATEGY: ${result.campaign.name}`,
      "",
      "CAMPAIGN SUMMARY",
      strategy.campaignSummary,
      "",
      "OBJECTIVE",
      strategy.objective,
      "",
      "CORE MESSAGE",
      strategy.coreMessage,
      "",
      "CONTENT PILLARS",
      ...strategy.contentPillars.flatMap((pillar) => [
        `• ${pillar.name}`,
        pillar.purpose,
        ...pillar.exampleTopics.map((topic) => `  - ${topic}`),
      ]),
      "",
      "PLATFORM STRATEGY",
      ...strategy.platformStrategy.map(
        (platform) =>
          `• ${platform.platform}: ${platform.role} | ${platform.frequency}`,
      ),
      "",
      "NEXT ACTIONS",
      ...strategy.nextActions.map((action) => `• ${action}`),
    ].join("\n");

    await navigator.clipboard.writeText(copyText);

    setCopied(true);
    setMessage("Campaign strategy copied.");

    window.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <section className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Atlas Campaign Intelligence
          </p>

          <h2>Campaign Strategy</h2>

          <p>
            Build an implementation-ready strategy using Brand Brain,
            Atlas Memory and the current campaign objective.
          </p>
        </div>

        <div className={styles.heroMeta}>
          <span>{campaignName}</span>
          <strong>
            {result ? "Strategy ready" : "Not generated"}
          </strong>
        </div>
      </header>

      <StrategyControls
        durationDays={durationDays}
        style={style}
        language={language}
        platforms={platforms}
        isGenerating={isGenerating}
        hasResult={Boolean(result)}
        message={message}
        onDurationChange={setDurationDays}
        onStyleChange={setStyle}
        onLanguageChange={setLanguage}
        onTogglePlatform={togglePlatform}
        onGenerate={() => void generateStrategy()}
      />

      {result ? (
        <StrategyContent
          result={result}
          copied={copied}
          onCopy={() => void copyStrategy()}
        />
      ) : (
        <section className={styles.emptyState}>
          <span>✦</span>
          <h3>No campaign strategy generated yet</h3>
          <p>
            Atlas will combine your campaign objective, Brand Brain
            and learned Memory to build the strategy.
          </p>
        </section>
      )}
    </section>
  );
}
