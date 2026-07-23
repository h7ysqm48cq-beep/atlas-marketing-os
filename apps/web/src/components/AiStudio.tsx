"use client";

import { useEffect, useState } from "react";
import { AiWorkspace, WorkspaceResult } from "./AiWorkspace";
import styles from "./AiStudio.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function AiStudio() {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("Nostalgia");
  const [language, setLanguage] = useState("Chinese");
  const [platforms] = useState([
    "Facebook",
    "Telegram",
    "Reels",
    "Image Prompt",
  ]);
  const [campaignId, setCampaignId] = useState("");
  const [ideaId, setIdeaId] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [ideaTitle, setIdeaTitle] = useState("");
  const [result, setResult] = useState<WorkspaceResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(
    "Enter a topic and click Generate content.",
  );

  useEffect(() => {
    let cancelled = false;

    async function initialiseWorkspace() {
      const params = new URLSearchParams(window.location.search);

      const topicParam = params.get("topic") || "";
      const styleParam = params.get("style") || "";
      const languageParam = params.get("language") || "";
      const campaignParam = params.get("campaignId") || "";
      const ideaParam = params.get("ideaId") || "";
      const campaignNameParam = params.get("campaignName") || "";
      const ideaTitleParam = params.get("ideaTitle") || "";
      const historyParam = params.get("historyId") || "";

      if (topicParam) setTopic(topicParam);
      if (styleParam) setStyle(styleParam);
      if (languageParam) setLanguage(languageParam);
      if (campaignParam) setCampaignId(campaignParam);
      if (ideaParam) setIdeaId(ideaParam);
      if (campaignNameParam) setCampaignName(campaignNameParam);
      if (ideaTitleParam) setIdeaTitle(ideaTitleParam);

      if (!historyParam) {
        if (campaignParam || ideaParam) {
          setMessage(
            "Campaign context loaded. Ready to generate.",
          );
        }

        return;
      }

      setMessage("Restoring saved AI workspace...");

      try {
        const response = await fetch(
          `${API_BASE_URL}/history/${historyParam}`,
          {
            cache: "no-store",
          },
        );

        const record = (await response.json()) as {
          id: string;
          topic: string;
          style: string;
          language: string;
          facebook: string;
          telegram: string;
          reels: string;
          imagePrompt: string;
          analysis: WorkspaceResult["analysis"];
          campaign: {
            id: string;
            name: string;
          } | null;
          idea: {
            id: string;
            title: string;
          } | null;
          message?: string;
        };

        if (!response.ok || !record.id) {
          throw new Error(
            record.message || "Unable to restore workspace.",
          );
        }

        if (cancelled) return;

        setTopic(record.topic);
        setStyle(record.style);
        setLanguage(record.language);

        if (record.campaign) {
          setCampaignId(record.campaign.id);
          setCampaignName(record.campaign.name);
        }

        if (record.idea) {
          setIdeaId(record.idea.id);
          setIdeaTitle(record.idea.title);
        }

        const restoredResult: WorkspaceResult = {
          facebook: record.facebook,
          telegram: record.telegram,
          reels: record.reels,
          image: record.imagePrompt,
          analysis: record.analysis,
          historyId: record.id,
          ...(record.campaign
            ? {
                campaignUsed: {
                  id: record.campaign.id,
                  name: record.campaign.name,
                },
              }
            : {}),
          ...(record.idea
            ? {
                ideaUsed: {
                  id: record.idea.id,
                  title: record.idea.title,
                },
              }
            : {}),
        };

        setResult(restoredResult);
        setMessage(
          record.campaign
            ? `Workspace restored · Linked to ${record.campaign.name}`
            : "Workspace restored from Content History.",
        );
      } catch (error) {
        if (cancelled) return;

        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to restore workspace.",
        );
      }
    }

    void initialiseWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  async function generateContent() {
    if (!topic.trim()) {
      setMessage("Topic is required.");
      return;
    }

    setIsGenerating(true);
    setMessage("Reading Brand Brain and Campaign context...");

    try {
      const response = await fetch(`${API_BASE_URL}/ai/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topic.trim(),
          platforms,
          style,
          language,
          campaignId: campaignId || undefined,
          ideaId: ideaId || undefined,
        }),
      });

      setMessage("Building platform-specific outputs...");

      const data = (await response.json()) as
        | WorkspaceResult
        | { message?: string };

      if (!response.ok || !("facebook" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to generate content.",
        );
      }

      setResult(data);
      setMessage(
        data.campaignUsed
          ? `Workspace complete · Saved to ${data.campaignUsed.name}`
          : "Workspace complete · Saved to Content History",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to generate content.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>AI Studio</p>
          <h1>Build a complete marketing workspace.</h1>
          <p>
            Generate, compare and manage every platform output without leaving
            one unified workspace.
          </p>
        </div>

        {campaignId ? (
          <div className={styles.contextCard}>
            <div className={styles.contextHeading}>
              <span>Campaign context</span>
              <strong>{campaignName || "Selected campaign"}</strong>
              <small>{ideaTitle || topic || "Selected content idea"}</small>
            </div>

            <div className={styles.contextActions}>
              <a href={`/campaigns/${encodeURIComponent(campaignId)}`}>
                Back to campaign
              </a>

              <a
                href={`/campaigns/${encodeURIComponent(
                  campaignId,
                )}?tab=assets`}
              >
                Campaign assets
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.layout}>
        <aside className={styles.formCard}>
          <label className={styles.field}>
            <span>Topic</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Enter a content topic..."
            />
          </label>

          <div className={styles.platforms}>
            <span>Platforms</span>
            <div>
              {platforms.map((platform) => (
                <button type="button" key={platform}>
                  ✓ {platform}
                </button>
              ))}
            </div>
          </div>

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

          {campaignId ? (
            <div className={styles.linkedContext}>
              <span>Linked workflow</span>
              <strong>{campaignName || campaignId}</strong>
              <small>{ideaTitle || ideaId || "Campaign-level generation"}</small>

              <div className={styles.linkedMeta}>
                <span>
                  Campaign
                  <strong>{campaignId}</strong>
                </span>

                <span>
                  Idea
                  <strong>{ideaId || "Campaign-level"}</strong>
                </span>

                <span>
                  History
                  <strong>
                    {result?.historyId
                      ? "Saved"
                      : "Created after generation"}
                  </strong>
                </span>
              </div>
            </div>
          ) : null}

          <button
            className={styles.generateButton}
            onClick={() => void generateContent()}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating workspace..." : "✦ Generate workspace"}
          </button>

          <p className={styles.message}>{message}</p>
        </aside>

        <AiWorkspace
          topic={topic}
          result={result}
          campaignId={campaignId || undefined}
          isGenerating={isGenerating}
          statusMessage={message}
          onMessage={setMessage}
	  onResultChange={setResult}
        />
      </section>
    </div>
  );
}
